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
import * as lambda from 'aws-cdk-lib/aws-lambda';
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

    const handler = new lambda.DockerImageFunction(this, 'BffFunction', {
      // Content-addressed image; the platform is pinned so an Apple Silicon build
      // hashes the same as CI's x86 runners (btfp learned this the hard way).
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '../../../apps/bff'), {
        platform: Platform.LINUX_AMD64,
      }),
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
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
        ...githubEnv,
      },
    });

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
