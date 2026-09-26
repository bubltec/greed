import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { loadSource } from './load-source.js';
import { transform } from './transform.js';

/**
 * Seeds the content table from data/seed/source. Insert-only: every put is
 * conditional on the row not existing, so running this against a table the
 * CMS has already edited never overwrites anyone's work.
 *
 *   pnpm seed:local                                          # DynamoDB Local
 *   CONTENT_TABLE_NAME=greed-prod-content pnpm --filter @greed/seed exec tsx src/run.ts --remote
 */
const remote = process.argv.includes('--remote');
const endpoint = remote ? undefined : (process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8000');
const tableName = process.env.CONTENT_TABLE_NAME ?? 'greed-local-content';

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...(endpoint ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}),
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

const { items, relations } = loadSource();
const { snapshot, report } = transform(items, relations);

const rows = [
  ...snapshot.topics.map((t) => ({ PK: `TOPIC#${t.id}`, SK: 'TOPIC', entity: 'topic', ...t })),
  ...snapshot.references.map((r) => ({ PK: `TOPIC#${r.topicId}`, SK: `REF#${r.id}`, entity: 'reference', ...r })),
  ...snapshot.relations.map((r) => ({ PK: `REL#${r.id}`, SK: 'REL', entity: 'relation', ...r })),
];

let written = 0;
let skipped = 0;
for (const Item of rows) {
  try {
    await db.send(
      new PutCommand({ TableName: tableName, Item, ConditionExpression: 'attribute_not_exists(PK)' }),
    );
    written++;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) skipped++;
    else throw err;
  }
}

console.log(
  JSON.stringify({ table: tableName, endpoint: endpoint ?? 'aws', written, skipped, ...report }, null, 2),
);
