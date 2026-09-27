import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { loadReferenceUrls } from './load-source.js';

/**
 * Fills in article links for sources the original index cited by name only,
 * from the reviewed list in source/reference-urls.json. Only touches
 * references whose url is still empty, so links an editor has already set are
 * never overwritten. Low-confidence matches are skipped unless
 * --include-low. Dry run unless --yes.
 *
 *   CONTENT_TABLE_NAME=greed-dev-content pnpm data:fill-reference-urls [--yes] [--include-low]
 */
const table = process.env.CONTENT_TABLE_NAME;
if (!table) throw new Error('Set CONTENT_TABLE_NAME, e.g. greed-dev-content');
const apply = process.argv.includes('--yes');
const includeLow = process.argv.includes('--include-low');
const endpoint = process.env.DYNAMODB_ENDPOINT;
const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...(endpoint ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}),
  }),
);

const entries = loadReferenceUrls();
const report = { table, apply, filled: [] as string[], alreadyLinked: [] as string[], missingRow: [] as string[], skippedLow: [] as string[], notFound: [] as string[] };
const now = new Date().toISOString();

for (const e of entries) {
  const tag = `${e.topicId} / ${e.label}`;
  if (!e.url) {
    report.notFound.push(tag);
    continue;
  }
  if (e.confidence === 'low' && !includeLow) {
    report.skippedLow.push(tag);
    continue;
  }
  const Key = { PK: `TOPIC#${e.topicId}`, SK: `REF#${e.referenceId}` };
  const { Item } = await db.send(new GetCommand({ TableName: table, Key, ProjectionExpression: 'id, #u', ExpressionAttributeNames: { '#u': 'url' } }));
  if (!Item) {
    report.missingRow.push(tag);
    continue;
  }
  if (Item.url) {
    report.alreadyLinked.push(tag);
    continue;
  }
  report.filled.push(tag);
  if (apply) {
    await db.send(
      new UpdateCommand({
        TableName: table,
        Key,
        UpdateExpression: 'SET #u = :url, updatedAt = :now, updatedBy = :by',
        ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(#u) OR #u = :empty)',
        ExpressionAttributeNames: { '#u': 'url' },
        ExpressionAttributeValues: { ':url': e.url, ':now': now, ':by': 'link-fill', ':empty': '' },
      }),
    );
  }
}

// Tables seeded before the parser kept parentheses inside URLs hold this one
// source with its link stuck in the name. Split it back out, if still untouched.
const REPAIRS = [
  {
    topicId: 'heritage-foundation-project-2025-and-its-implement',
    referenceId: 'ref_6b61751436a6',
    from: 'Wikipedia (https://en.wikipedia.org/wiki/Kevin_Roberts_(political_strategist))',
    label: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Kevin_Roberts_(political_strategist)',
  },
];
const repaired: string[] = [];
for (const r of REPAIRS) {
  const Key = { PK: `TOPIC#${r.topicId}`, SK: `REF#${r.referenceId}` };
  const { Item } = await db.send(new GetCommand({ TableName: table, Key }));
  if (Item?.label !== r.from || Item.url) continue;
  repaired.push(`${r.topicId} / ${r.label}`);
  if (apply) {
    await db.send(
      new UpdateCommand({
        TableName: table,
        Key,
        UpdateExpression: 'SET label = :label, #u = :url, updatedAt = :now, updatedBy = :by',
        ConditionExpression: 'label = :from',
        ExpressionAttributeNames: { '#u': 'url' },
        ExpressionAttributeValues: { ':label': r.label, ':url': r.url, ':from': r.from, ':now': now, ':by': 'link-fill' },
      }),
    );
  }
}
Object.assign(report, { repaired });

console.log(JSON.stringify({ ...report, counts: Object.fromEntries(Object.entries(report).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as string[]).length])) }, null, 2));
console.log(apply ? `Filled ${report.filled.length} links.` : 'Dry run. Re-run with --yes to apply.');
