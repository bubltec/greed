import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';
import { authTableName, contentTableName, usersTableName } from './env.js';

/**
 * Local only (DYNAMODB_ENDPOINT set): create the tables with the same
 * key schema CDK gives them, so `pnpm dev` works against a fresh DynamoDB Local.
 */
export async function ensureLocalTables(): Promise<void> {
  const endpoint = process.env.DYNAMODB_ENDPOINT;
  if (!endpoint) return;
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  const tables = [
    new CreateTableCommand({
      TableName: contentTableName(),
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    }),
    new CreateTableCommand({
      TableName: usersTableName(),
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [{ AttributeName: 'GSI1PK', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
    new CreateTableCommand({
      TableName: authTableName(),
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }],
    }),
  ];
  for (const command of tables) {
    try {
      await client.send(command);
    } catch (err) {
      if (!(err instanceof ResourceInUseException)) throw err;
    }
  }
}
