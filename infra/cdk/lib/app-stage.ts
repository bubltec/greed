import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { ApiStack } from './api-stack.js';
import type { EnvConfig } from './config.js';
import { DataStack } from './data-stack.js';
import { WebStack } from './web-stack.js';

export interface AppStageProps extends cdk.StageProps {
  envConfig: EnvConfig;
}

/** One environment: tables, the BFF Lambda, and the CloudFront site in front of both. */
export class AppStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props: AppStageProps) {
    super(scope, id, props);
    const data = new DataStack(this, 'Data', { env: props.env, envConfig: props.envConfig });
    const api = new ApiStack(this, 'Api', {
      env: props.env,
      envConfig: props.envConfig,
      contentTable: data.contentTable,
      usersTable: data.usersTable,
      authTable: data.authTable,
    });
    new WebStack(this, 'Web', { env: props.env, envConfig: props.envConfig, httpApi: api.httpApi });
  }
}
