import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { grantSsmConfigRead } from '@bubltec/mycota-cdk';
import {
  ALERT_EMAIL,
  EDITORS,
  type EnvConfig,
  GITHUB_CLIENT_ID,
  SSM_NAMESPACE,
  ssmParam,
} from './config.js';
import { pinFingerprint, WEB_SEARCH_VERSION } from './pin-web-search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ApiStackProps extends cdk.StackProps {
  envConfig: EnvConfig;
  contentTable: dynamodb.Table;
  usersTable: dynamodb.Table;
  authTable: dynamodb.Table;
}

/**
 * One Lambda running the whole NestJS BFF behind an HTTP API; CloudFront
 * (WebStack) fronts it at /api/*, so the API needs no domain or cert of its own.
 */
export class ApiStack extends cdk.Stack {
  readonly httpApi: apigwv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { envName, domainName } = props.envConfig;
    const isProd = envName === 'prod';
    const origin = `https://${domainName}`;

    // GitHub sign-in only where an OAuth app is registered (one callback URL per app).
    const githubEnv: Record<string, string> =
      isProd && GITHUB_CLIENT_ID
        ? {
            GITHUB_CLIENT_ID,
            GITHUB_CLIENT_SECRET_PARAM: ssmParam(envName, 'github-client-secret'),
            GITHUB_CALLBACK_URL: `${origin}/api/auth/github/callback`,
          }
        : {};

    const gatewayRole = new iam.Role(this, 'ResearchGatewayRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
      description: `AgentCore Gateway role for ${envName} topic research`,
    });
    gatewayRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeWebSearch'],
        resources: [`arn:aws:bedrock-agentcore:${this.region}:aws:tool/web-search.v1`],
      }),
    );

    // ConnectorSource in CloudFormation has ConnectorId only. Early validation
    // rejects Version. The target is created on the connector default, then
    // PinWebSearch moves it to 1.2.0, which is the release that filters domains.
    const gateway = new cdk.CfnResource(this, 'ResearchGateway', {
      type: 'AWS::BedrockAgentCore::Gateway',
      properties: {
        Name: `greed-${envName}-research`,
        Description: 'Web search for GREED topic research',
        RoleArn: gatewayRole.roleArn,
        ProtocolType: 'MCP',
        AuthorizerType: 'AWS_IAM',
      },
    });
    // What CloudFormation owns on the target. Any change here makes it update the
    // target, which drops the pinned connector version, so it also keys the pin.
    const searchTargetConfig = {
      name: 'web-search',
      description: 'AgentCore Web Search. Version is pinned by PinWebSearch, not this resource.',
      targetConfiguration: {
        mcp: {
          connector: {
            source: { connectorId: 'web-search' },
            configurations: [{ name: 'WebSearch', parameterValues: {} }],
          },
        },
      },
      credentialProviderConfigurations: [{ credentialProviderType: 'GATEWAY_IAM_ROLE' }],
    };
    const searchTarget = new agentcore.CfnGatewayTarget(this, 'ResearchSearchTarget', {
      gatewayIdentifier: gateway.getAtt('GatewayIdentifier').toString(),
      ...searchTargetConfig,
    });
    const pinFn = new NodejsFunction(this, 'PinWebSearchFn', {
      entry: path.join(__dirname, 'pin-web-search.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(3),
      description: `Pin the ${envName} web-search target to connector ${WEB_SEARCH_VERSION}`,
      // The Lambda runtime does not ship the AgentCore control client.
      bundling: { externalModules: [], minify: true },
    });
    pinFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:GetGatewayTarget', 'bedrock-agentcore:UpdateGatewayTarget'],
        resources: [gateway.getAtt('GatewayArn').toString()],
      }),
    );
    const pin = new cdk.CustomResource(this, 'PinWebSearchVersion', {
      serviceToken: new cr.Provider(this, 'PinWebSearchProvider', { onEventHandler: pinFn }).serviceToken,
      properties: {
        GatewayIdentifier: gateway.getAtt('GatewayIdentifier').toString(),
        TargetId: searchTarget.attrTargetId,
        Version: WEB_SEARCH_VERSION,
        ConfigHash: pinFingerprint(searchTargetConfig),
      },
    });
    pin.node.addDependency(searchTarget);
    // Short-term events only. Seven days, then a dive searches again.
    const memory = new agentcore.CfnMemory(this, 'ResearchMemory', {
      name: `greed_${envName}_research`,
      description: 'Short-term record of web searches already run for a GREED topic',
      eventExpiryDuration: 7,
    });

    const handler = new lambda.DockerImageFunction(this, 'BffFunction', {
      // Content-addressed image; the platform is pinned so an Apple Silicon build
      // hashes the same as CI's x86 runners (btfp learned this the hard way).
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '../../../apps/bff'), {
        platform: Platform.LINUX_AMD64,
      }),
      memorySize: 512,
      // research_topic runs up to three web searches together in one call.
      timeout: cdk.Duration.seconds(29),
      logGroup: new logs.LogGroup(this, 'BffLogGroup', {
        retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.TWO_WEEKS,
        removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--enable-source-maps',
        STAGE: envName,
        CONTENT_TABLE_NAME: props.contentTable.tableName,
        USERS_TABLE_NAME: props.usersTable.tableName,
        AUTH_TABLE_NAME: props.authTable.tableName,
        WEB_ORIGIN: origin,
        EDITORS,
        JWT_SECRET_PARAM: ssmParam(envName, 'jwt-secret'),
        COURT_LISTENER_API_KEY_PARAM: ssmParam(envName, 'courtlistener-token'),
        DATA_GOV_API_KEY_PARAM: ssmParam(envName, 'data-gov-key'),
        AGENTCORE_GATEWAY_URL: gateway.getAtt('GatewayUrl').toString(),
        AGENTCORE_MEMORY_ID: memory.attrMemoryId,
        ...githubEnv,
      },
    });

    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeGateway'],
        resources: [gateway.getAtt('GatewayArn').toString()],
      }),
    );
    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:CreateEvent', 'bedrock-agentcore:ListEvents'],
        resources: [memory.attrMemoryArn],
      }),
    );

    props.contentTable.grantReadWriteData(handler);
    props.usersTable.grantReadWriteData(handler);
    props.authTable.grantReadWriteData(handler);
    grantSsmConfigRead(handler, { namespace: SSM_NAMESPACE, env: envName, includeShared: false });

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `greed-${envName}-api`,
      defaultIntegration: new HttpLambdaIntegration('BffIntegration', handler),
    });

    if (isProd) {
      // Confirm the SNS subscription email once, or alerts go nowhere.
      const alerts = new sns.Topic(this, 'AlertsTopic');
      alerts.addSubscription(new subscriptions.EmailSubscription(ALERT_EMAIL));
      new cloudwatch.Alarm(this, 'ApiServerErrors', {
        alarmDescription: 'greed API returned 3+ 5xx responses in 5 minutes',
        metric: this.httpApi.metricServerError({ period: cdk.Duration.minutes(5), statistic: 'sum' }),
        threshold: 3,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new cloudwatchActions.SnsAction(alerts));
    }

    new cdk.CfnOutput(this, 'HttpApiUrl', { value: this.httpApi.apiEndpoint });
  }
}
