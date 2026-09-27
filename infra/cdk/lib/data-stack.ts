import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type { EnvConfig } from './config.js';

export interface DataStackProps extends cdk.StackProps {
  envConfig: EnvConfig;
}

/**
 * Content (single table, see docs/data-model.md) and mycota-auth's users
 * table. On-demand billing; prod tables are retained and point-in-time
 * recoverable, because the content is the product.
 */
export class DataStack extends cdk.Stack {
  readonly contentTable: dynamodb.Table;
  readonly usersTable: dynamodb.Table;
  readonly authTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const isProd = props.envConfig.envName === 'prod';
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    this.contentTable = new dynamodb.Table(this, 'ContentTable', {
      tableName: `greed-${props.envConfig.envName}-content`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: isProd },
      deletionProtection: isProd,
      removalPolicy,
    });

    // Key schema mycota-auth's UsersService expects (PK + GSI1 on GSI1PK).
    this.usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: `greed-${props.envConfig.envName}-users`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });
    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
    });

    // OAuth clients, codes and tokens for the MCP connector. Only hashes are
    // stored; codes and tokens expire through the `ttl` attribute. Losing this
    // table only means reconnecting Claude, so it is never retained.
    this.authTable = new dynamodb.Table(this, 'AuthTable', {
      tableName: `greed-${props.envConfig.envName}-auth`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}
