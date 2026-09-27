import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

/**
 * Replaces dev's content with a copy of prod's (drafts included), so dev can be
 * used to try code changes against real data. One-way by design: nothing ever
 * flows from dev to prod. Dry run unless --yes.
 *
 *   pnpm data:refresh-dev          # shows what would change
 *   pnpm data:refresh-dev --yes    # does it
 */
const SOURCE = process.env.SOURCE_TABLE ?? 'greed-prod-content';
const TARGET = process.env.TARGET_TABLE ?? 'greed-dev-content';
const apply = process.argv.includes('--yes');
if (TARGET.includes('prod')) throw new Error(`Refusing to overwrite ${TARGET}: the target must not be prod.`);

const endpoint = process.env.DYNAMODB_ENDPOINT;
const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...(endpoint ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}),
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

type Row = Record<string, unknown> & { PK: string; SK: string };

async function scanAll(table: string): Promise<Row[]> {
  const rows: Row[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new ScanCommand({ TableName: table, ExclusiveStartKey }));
    rows.push(...((page.Items ?? []) as Row[]));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return rows;
}

async function batch(table: string, requests: Record<string, unknown>[]) {
  for (let i = 0; i < requests.length; i += 25) {
    let pending: Record<string, unknown[]> = { [table]: requests.slice(i, i + 25) };
    for (let attempt = 0; Object.keys(pending).length > 0; attempt++) {
      if (attempt === 8) throw new Error('BatchWrite kept returning unprocessed items');
      const res = await db.send(new BatchWriteCommand({ RequestItems: pending as never }));
      pending = (res.UnprocessedItems ?? {}) as Record<string, unknown[]>;
      if (Object.keys(pending).length > 0) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
  }
}

const [source, target] = await Promise.all([scanAll(SOURCE), scanAll(TARGET)]);
const count = (rows: Row[], prefix: string) => rows.filter((r) => r.SK.startsWith(prefix)).length;
const summary = (rows: Row[]) => ({
  topics: count(rows, 'TOPIC'),
  references: count(rows, 'REF#'),
  perspectives: count(rows, 'PERSP#'),
  relations: count(rows, 'REL'),
});
console.log(JSON.stringify({ from: SOURCE, to: TARGET, source: summary(source), replacing: summary(target), apply }, null, 2));

if (!apply) {
  console.log('Dry run. Re-run with --yes to replace dev content with this copy of prod.');
} else {
  await batch(TARGET, target.map((r) => ({ DeleteRequest: { Key: { PK: r.PK, SK: r.SK } } })));
  await batch(TARGET, source.map((Item) => ({ PutRequest: { Item } })));
  console.log(`Done: ${TARGET} now mirrors ${SOURCE} (${source.length} rows).`);
}
