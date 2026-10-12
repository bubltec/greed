import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import type * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import {
  DEV_BASIC_AUTH_PASSWORD,
  DEV_BASIC_AUTH_USER,
  type EnvConfig,
  HOSTED_ZONE_ID,
  ROOT_DOMAIN,
  WAF_ARN_PARAMETER,
} from './config.js';
import { PUBLIC_API_PATHS, SESSION_COOKIE } from './public-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface WebStackProps extends cdk.StackProps {
  envConfig: EnvConfig;
  httpApi: apigwv2.HttpApi;
}

/**
 * Viewer-request function. `documents` rewrites extensionless pages (and the
 * model/sitemap files) onto the API, which returns that page’s HTML. Asset
 * behaviors leave it off so `/assets/*` stays a bucket key.
 */
export function viewerRequestCode(opts: { basicAuth?: string; documents?: boolean }): string {
  const auth = opts.basicAuth
    ? `
  var h = request.headers.authorization;
  if (!h || h.value !== ${JSON.stringify(opts.basicAuth)}) {
    return {
      statusCode: 401,
      statusDescription: 'Unauthorized',
      headers: { 'www-authenticate': { value: 'Basic realm="greed dev"' } },
    };
  }`
    : '';
  const documents = opts.documents
    ? `
  var uri = request.uri;
  if (uri.length > 1 && uri.charAt(uri.length - 1) === '/') uri = uri.substring(0, uri.length - 1);
  if (uri === '/llms.txt') request.uri = '/api/llms.txt';
  else if (uri === '/sitemap.xml') request.uri = '/api/sitemap.xml';
  else if (uri === '/robots.txt') request.uri = '/api/robots.txt';
  else {
    var last = uri.split('/').pop();
    if (uri === '/' || last.indexOf('.') === -1) request.uri = '/api/html' + (uri === '/' ? '' : uri);
  }`
    : '';
  return `function handler(event) {
  var request = event.request;${auth}${documents}
  return request;
}`;
}

/**
 * Private S3 + CloudFront (OAC) for the React assets. Extensionless pages are
 * HTML from the BFF (unique title, description, and the page text) on the same
 * origin (no CORS in any deployed stage), a DNS-validated
 * certificate, and the alias record. Dev is Basic-Auth-walled by a CloudFront
 * Function (cheaper than btfp's WAF rule for the same effect) and noindex.
 * Prod gets a WAF rate limit in front of everything.
 */
export class WebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    const { envName, domainName } = props.envConfig;
    const isProd = envName === 'prod';

    const zone = route53.PublicHostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: HOSTED_ZONE_ID,
      zoneName: ROOT_DOMAIN,
    });

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const basicAuth = isProd
      ? undefined
      : `Basic ${Buffer.from(`${DEV_BASIC_AUTH_USER}:${DEV_BASIC_AUTH_PASSWORD}`).toString('base64')}`;
    const siteFunction = new cloudfront.Function(this, 'SiteRequest', {
      code: cloudfront.FunctionCode.fromInline(viewerRequestCode({ basicAuth, documents: true })),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });
    const apiFunction = basicAuth
      ? new cloudfront.Function(this, 'ApiRequest', {
          code: cloudfront.FunctionCode.fromInline(viewerRequestCode({ basicAuth })),
          runtime: cloudfront.FunctionRuntime.JS_2_0,
        })
      : undefined;

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'Headers', {
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: false,
          override: true,
        },
      },
      customHeadersBehavior: isProd
        ? undefined
        : { customHeaders: [{ header: 'X-Robots-Tag', value: 'noindex, nofollow', override: true }] },
    });

    // "https://{id}.execute-api.{region}.amazonaws.com" -> host only.
    const apiHost = cdk.Fn.select(2, cdk.Fn.split('/', props.httpApi.apiEndpoint));

    let webAclId: string | undefined;
    if (isProd) {
      // Owned by the dotio repo (DotioWaf): one ACL shared by every bubbletech site.
      webAclId = ssm.StringParameter.valueForStringParameter(this, WAF_ARN_PARAMETER);
    }

    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: new origins.HttpOrigin(apiHost, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY }),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      // Strip Host so API Gateway sees its own execute-api hostname.
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy: securityHeaders,
      functionAssociations: apiFunction
        ? [{ function: apiFunction, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }]
        : undefined,
    };

    // Public reads (see PUBLIC_API_PATHS): cached 60s at the edge so a flood of identical reads
    // is absorbed by CloudFront, and an origin 5xx falls back to the last good copy via the
    // `stale-if-error` the BFF sends. The cache key is the query string plus the editor session
    // cookie: readers have none (one shared entry), an editor's `?preview=1` carries it to the
    // origin and is never marked cacheable.
    //
    // Editors publish and edit on these same paths (`POST /api/topics/:id/publish`, page
    // publish, reference edits). CloudFront picks one behavior per path, so this one has to
    // allow those methods and forward the body. Only GET and HEAD are cached.
    const publicApiCachePolicy = new cloudfront.CachePolicy(this, 'PublicApiCachePolicy', {
      minTtl: cdk.Duration.seconds(0),
      defaultTtl: cdk.Duration.seconds(0), // only cache what the BFF marks cacheable
      maxTtl: cdk.Duration.minutes(5),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.allowList(SESSION_COOKIE),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });
    const publicApiBehavior: cloudfront.BehaviorOptions = {
      ...apiBehavior,
      cachePolicy: publicApiCachePolicy,
    };
    // The dataset download is large. Honor a 30-minute origin max-age; the shared
    // policy above caps everything else at 5 minutes. Preview stays uncached
    // because the origin sends no cache header for `?preview=1` and default TTL is 0.
    const exportCachePolicy = new cloudfront.CachePolicy(this, 'ExportCachePolicy', {
      minTtl: cdk.Duration.seconds(0),
      defaultTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.minutes(30),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.allowList(SESSION_COOKIE),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });
    const publicApiBehaviors: Record<string, cloudfront.BehaviorOptions> = {};
    for (const name of PUBLIC_API_PATHS) {
      publicApiBehaviors[`/api/${name}`] = publicApiBehavior;
      publicApiBehaviors[`/api/${name}/*`] = publicApiBehavior;
    }
    publicApiBehaviors['/api/export'] = { ...publicApiBehavior, cachePolicy: exportCachePolicy };

    // Pages are HTML from the API (unique title, description, and the page text).
    // Hashed assets and the icon stay on S3; a longer path pattern wins over the default.
    const assetBehavior: cloudfront.BehaviorOptions = {
      origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      responseHeadersPolicy: securityHeaders,
      functionAssociations: apiFunction
        ? [{ function: apiFunction, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }]
        : undefined,
    };
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      domainNames: [domainName],
      certificate,
      webAclId,
      defaultBehavior: {
        origin: new origins.HttpOrigin(apiHost, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: publicApiCachePolicy,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy: securityHeaders,
        functionAssociations: [{ function: siteFunction, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/assets/*': assetBehavior,
        '/favicon.svg': assetBehavior,
        ...publicApiBehaviors,
        '/api/*': apiBehavior,
        // OAuth discovery for the MCP connector (RFC 8414 / RFC 9728) lives at the root.
        '/.well-known/*': apiBehavior,
      },
    });

    for (const [id, Record] of [
      ['A', route53.ARecord],
      ['AAAA', route53.AaaaRecord],
    ] as const) {
      new Record(this, `Alias${id}`, {
        zone,
        recordName: domainName,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
      });
    }

    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../../apps/web/dist'))],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'Url', { value: `https://${domainName}` });
    new cdk.CfnOutput(this, 'DistributionDomainName', { value: distribution.distributionDomainName });
  }
}
