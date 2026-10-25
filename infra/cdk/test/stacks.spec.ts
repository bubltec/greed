import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AppStage } from '../lib/app-stage.js';
import { environments } from '../lib/config.js';
import { viewerRequestCode } from '../lib/web-stack.js';

/**
 * Synthesises both stages without AWS credentials. The Lambda image and web
 * assets must exist (turbo builds them first), same as `cdk synth`.
 */
function synth(envName: 'dev' | 'prod') {
  const app = new cdk.App();
  const stage = new AppStage(app, envName === 'dev' ? 'GreedDev' : 'GreedProd', {
    env: { account: '288892511071', region: 'us-east-1' },
    envConfig: environments[envName],
  });
  const stacks = stage.node.children.filter((c): c is cdk.Stack => c instanceof cdk.Stack);
  const byId = (id: string) => Template.fromStack(stacks.find((s) => s.node.id === id)!);
  return { data: byId('Data'), api: byId('Api'), web: byId('Web') };
}

describe('GreedProd', () => {
  const { data, api, web } = synth('prod');

  it('protects prod content', () => {
    data.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'greed-prod-content',
      DeletionProtectionEnabled: true,
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  it('caches public reads at the edge, keyed on the editor session cookie only', () => {
    web.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        DefaultTTL: 0,
        MaxTTL: 300,
        ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
          CookiesConfig: { CookieBehavior: 'whitelist', Cookies: ['greed_session'] },
          QueryStringsConfig: { QueryStringBehavior: 'all' },
        }),
      }),
    });
    web.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: Match.arrayWith([
          // Publish and the other topic writes share this path, so the cached behavior
          // has to accept them. Only GET and HEAD are cached.
          Match.objectLike({
            PathPattern: '/api/topics/*',
            AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE'],
            // Omitted means GET and HEAD only, so a publish POST is not cached.
            CachedMethods: Match.absent(),
            OriginRequestPolicyId: Match.anyValue(),
          }),
          Match.objectLike({ PathPattern: '/api/browse' }),
        ]),
      }),
    });
    web.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({ DefaultTTL: 0, MaxTTL: 1800 }),
    });
    const policies = web.findResources('AWS::CloudFront::CachePolicy');
    const exportPolicy = Object.keys(policies).find((id) => policies[id]?.Properties?.CachePolicyConfig?.MaxTTL === 1800);
    const behaviors = Object.values(web.findResources('AWS::CloudFront::Distribution'))[0] as {
      Properties: { DistributionConfig: { CacheBehaviors: { PathPattern: string; CachePolicyId: { Ref: string } }[] } };
    };
    const exportBehavior = behaviors.Properties.DistributionConfig.CacheBehaviors.find((b) => b.PathPattern === '/api/export');
    expect(exportBehavior?.CachePolicyId).toEqual({ Ref: exportPolicy });
  });

  it('archives evidence in a private, versioned, TLS-only bucket that prod retains', () => {
    data.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      VersioningConfiguration: { Status: 'Enabled' },
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
    });
    data.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
    data.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } })]) },
    });
    expect(JSON.stringify(data.toJSON())).not.toContain('Custom::S3AutoDeleteObjects');
  });

  it('lets the API read and write the archive, and run OCR, but never delete evidence', () => {
    api.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 29,
      Environment: { Variables: Match.objectLike({ ARCHIVE_BUCKET: Match.anyValue(), ARCHIVE_OCR: 'textract' }) },
    });
    const policies = JSON.stringify(api.findResources('AWS::IAM::Policy'));
    for (const action of ['DetectDocumentText', 'StartDocumentTextDetection', 'GetDocumentTextDetection']) expect(policies).toContain(`textract:${action}`);
    expect(policies).not.toMatch(/textract:(\*|Analyze)/);
    expect(policies).toContain('s3:PutObject');
    expect(policies).toContain('s3:GetObject*');
    expect(policies).not.toContain('s3:DeleteObject');
    expect(policies).not.toMatch(/"s3:\*"/);
  });

  it('caps the whole API at 20 req/s (burst 40) so a flood from many IPs is answered with 429', () => {
    api.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: { ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 },
    });
  });

  it('keeps MCP OAuth state in its own expiring table', () => {
    data.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'greed-prod-auth',
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('gives the API a web-search gateway and a week of short-term research memory', () => {
    api.hasResourceProperties('AWS::BedrockAgentCore::Gateway', {
      Name: 'greed-prod-research',
      AuthorizerType: 'AWS_IAM',
      ProtocolType: 'MCP',
    });
    api.hasResourceProperties('AWS::BedrockAgentCore::GatewayTarget', {
      Name: 'web-search',
      TargetConfiguration: {
        Mcp: { Connector: { Source: { ConnectorId: 'web-search' }, Configurations: [{ Name: 'WebSearch' }] } },
      },
      CredentialProviderConfigurations: [{ CredentialProviderType: 'GATEWAY_IAM_ROLE' }],
    });
    for (const resource of Object.values(api.findResources('AWS::BedrockAgentCore::GatewayTarget'))) {
      const source = (resource as { Properties: { TargetConfiguration: { Mcp: { Connector: { Source: Record<string, string> } } } } }).Properties
        .TargetConfiguration.Mcp.Connector.Source;
      expect(source).toEqual({ ConnectorId: 'web-search' });
    }
    api.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      Version: '1.2.0',
      GatewayIdentifier: Match.anyValue(),
      TargetId: Match.anyValue(),
      ConfigHash: Match.stringLikeRegexp('^[0-9a-f]{16}$'),
    });
    expect(JSON.stringify(api.findResources('AWS::IAM::Policy'))).toContain('bedrock-agentcore:UpdateGatewayTarget');
    api.hasResourceProperties('AWS::BedrockAgentCore::Memory', {
      Name: 'greed_prod_research',
      EventExpiryDuration: 7,
    });
    api.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 29,
      Environment: { Variables: Match.objectLike({ AGENTCORE_GATEWAY_URL: Match.anyValue(), AGENTCORE_MEMORY_ID: Match.anyValue() }) },
    });
  });

  it('passes secret names, never secret values, to the Lambda', () => {
    api.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          STAGE: 'prod',
          WEB_ORIGIN: 'https://greed.bubbletech.io',
          JWT_SECRET_PARAM: '/greed/prod/jwt-secret',
        }),
      },
    });
    const vars = JSON.stringify(api.findResources('AWS::Lambda::Function'));
    expect(vars).not.toMatch(/"JWT_SECRET"/);
  });

  it('serves pages from the API, and assets from the bucket, with the built script names', () => {
    web.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: Match.absent(),
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({ PathPattern: '/assets/*' }),
          Match.objectLike({ PathPattern: '/favicon.svg' }),
        ]),
      }),
    });
    api.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          WEB_SCRIPT: Match.stringLikeRegexp('^/assets/.+\\.js$'),
          WEB_STYLE: Match.stringLikeRegexp('^/assets/.+\\.css$'),
        }),
      },
    });
  });

  it('serves greed.bubbletech.io with /api on the same origin behind the shared web ACL', () => {
    web.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['greed.bubbletech.io'],
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({ PathPattern: '/api/*' }),
          Match.objectLike({ PathPattern: '/.well-known/*' }),
        ]),
      }),
    });
    web.resourceCountIs('AWS::WAFv2::WebACL', 0);
    web.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ WebACLId: Match.anyValue() }),
    });
  });
});

describe('GreedDev', () => {
  const { data, web } = synth('dev');

  it('lets dev tear down its archive, unlike prod', () => {
    data.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Delete' });
    data.resourceCountIs('Custom::S3AutoDeleteObjects', 1);
  });

  it('walls dev off with basic auth on both behaviors and no WAF', () => {
    web.resourceCountIs('AWS::CloudFront::Function', 2);
    web.resourceCountIs('AWS::WAFv2::WebACL', 0);
    web.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: ['dev.greed.bubbletech.io'] }),
    });
  });
});

describe('viewerRequestCode', () => {
  it('produces a handler that rejects missing credentials and rewrites pages onto the API', () => {
    const code = viewerRequestCode({ basicAuth: 'Basic abc', documents: true });
    const handler = new Function(`${code}; return handler;`)() as (e: unknown) => {
      statusCode?: number;
      uri?: string;
    };
    const authed = (uri: string) => handler({ request: { uri, headers: { authorization: { value: 'Basic abc' } } } }).uri;
    expect(handler({ request: { uri: '/t/x', headers: {} } }).statusCode).toBe(401);
    expect(authed('/')).toBe('/api/html');
    expect(authed('/t/x')).toBe('/api/html/t/x');
    expect(authed('/about/')).toBe('/api/html/about');
    expect(authed('/llms.txt')).toBe('/api/llms.txt');
    expect(authed('/sitemap.xml')).toBe('/api/sitemap.xml');
    expect(authed('/robots.txt')).toBe('/api/robots.txt');
    expect(authed('/assets/a.js')).toBe('/assets/a.js');
  });
});
