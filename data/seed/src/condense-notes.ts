import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { loadCondensedNotes, loadSource } from './load-source.js';

/**
 * One-time migration for tables seeded before closing notes were shortened:
 * replaces each topic's long `disputed` paragraph with its one-sentence
 * version, but only where the text is still exactly what the import wrote, so
 * anything an editor has changed is left alone. Dry run unless --yes.
 *
 *   CONTENT_TABLE_NAME=greed-dev-content pnpm data:condense-notes [--yes]
 */
const table = process.env.CONTENT_TABLE_NAME;
if (!table) throw new Error('Set CONTENT_TABLE_NAME, e.g. greed-dev-content');
const apply = process.argv.includes('--yes');
const endpoint = process.env.DYNAMODB_ENDPOINT;
const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...(endpoint ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}),
  }),
);

const original = new Map(loadSource().items.map((i) => [i.id, (i.disputed ?? '').trim()]));
const notes = loadCondensedNotes();

const topics: { id: string; disputed?: string }[] = [];
let ExclusiveStartKey: Record<string, unknown> | undefined;
do {
  const page = await db.send(
    new ScanCommand({
      TableName: table,
      FilterExpression: 'SK = :sk',
      ExpressionAttributeValues: { ':sk': 'TOPIC' },
      ProjectionExpression: 'id, disputed',
      ExclusiveStartKey,
    }),
  );
  topics.push(...((page.Items ?? []) as { id: string; disputed?: string }[]));
  ExclusiveStartKey = page.LastEvaluatedKey;
} while (ExclusiveStartKey);

const todo = topics.filter((t) => notes[t.id] && t.disputed && t.disputed === original.get(t.id));
const edited = topics.filter((t) => notes[t.id] && t.disputed && t.disputed !== original.get(t.id) && t.disputed !== notes[t.id]);
console.log(JSON.stringify({ table, topics: topics.length, toCondense: todo.length, leftAloneBecauseEdited: edited.map((t) => t.id), apply }, null, 2));

if (apply) {
  for (const t of todo) {
    await db.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: `TOPIC#${t.id}`, SK: 'TOPIC' },
        UpdateExpression: 'SET disputed = :note',
        ConditionExpression: 'disputed = :old',
        ExpressionAttributeValues: { ':note': notes[t.id], ':old': t.disputed },
      }),
    );
  }
  console.log(`Condensed ${todo.length} notes.`);
} else {
  console.log('Dry run. Re-run with --yes to apply.');
}
