import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { GithubActionsDeployRole } from '@bubltec/mycota-cdk';
import { GITHUB_REPO } from './config.js';

/**
 * The role GitHub Actions assumes via OIDC to run `cdk deploy`: mycota's
 * shared construct, trusting `main` plus the `development` and `production`
 * GitHub Environments. It only holds sts:AssumeRole on the CDK bootstrap roles.
 */
export class CiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    const gha = new GithubActionsDeployRole(this, 'Gha', {
      repository: GITHUB_REPO,
      roleName: 'greed-gha-deploy',
    });
    new cdk.CfnOutput(this, 'DeployRoleArn', { value: gha.role.roleArn });
  }
}
