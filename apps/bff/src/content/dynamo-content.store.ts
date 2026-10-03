import {
  BatchWriteCommand,
  type DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  type ContentSnapshot,
  type ContentStore,
  ENTITY_DEFS,
  ENTITY_LIST,
  type EntityName,
  refOf,
  type RemoveTarget,
} from '@greed/domain';

/**
 * Single-table layout (see docs/data-model.md). Each entity's keys live in
 * ENTITY_DEFS (packages/domain/src/entity-defs.ts):
 *
 *   TOPIC#<id>  TOPIC          the topic
 *   TOPIC#<id>  REF#<refId>    a reference on that topic
 *   TOPIC#<id>  PERSP#<pId>    a perspective on that topic
 *   REL#<id>    REL            a relation (fromId/toId are attributes)
 *   PAGE#<id>   PAGE           an editable site page (home, about)
 *
 * Reads are one paginated Scan cached in ContentService: at a few hundred
 * rows that is cheaper and simpler than per-view queries (btfp does the same).
 */

type Row = Record<string, unknown> & { PK: string; SK: string; entity?: string };

function strip(row: Row): Record<string, unknown> {
  const { PK: _pk, SK: _sk, entity: _entity, ...rest } = row;
  return rest;
}

/** Sorts raw rows into a snapshot. Unknown rows are ignored, not fatal. */
export function rowsToSnapshot(rows: Row[]): ContentSnapshot {
  const snapshot: Record<string, unknown[]> = {};
  for (const def of ENTITY_LIST) snapshot[def.collection] = [];
  for (const row of rows) {
    const def = ENTITY_LIST.find((d) => d.owns(row.SK));
    if (def) snapshot[def.collection]!.push(strip(row));
  }
  return snapshot as unknown as ContentSnapshot;
}

export class DynamoContentStore implements ContentStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async loadAll(): Promise<ContentSnapshot> {
    const rows: Row[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await this.db.send(
        new ScanCommand({ TableName: this.tableName, ExclusiveStartKey }),
      );
      rows.push(...((page.Items ?? []) as Row[]));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return rowsToSnapshot(rows);
  }

  private putRow(item: Record<string, unknown>) {
    return this.db.send(new PutCommand({ TableName: this.tableName, Item: item }));
  }

  async put(entity: EntityName, item: { id: string }) {
    const def = ENTITY_DEFS[entity];
    await this.putRow({ ...def.address(refOf(def, item)), entity, ...item });
  }

  async remove(targets: RemoveTarget[]) {
    await this.batchDelete(targets.map((t) => ENTITY_DEFS[t.entity].address(t.ref)));
  }

  private async batchDelete(keysToDelete: { PK: string; SK: string }[]) {
    for (let i = 0; i < keysToDelete.length; i += 25) {
      let requests: Record<string, unknown[]> = {
        [this.tableName]: keysToDelete.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })),
      };
      for (let attempt = 0; attempt < 5 && Object.keys(requests).length > 0; attempt++) {
        const result = await this.db.send(
          new BatchWriteCommand({ RequestItems: requests as never }),
        );
        requests = (result.UnprocessedItems ?? {}) as Record<string, unknown[]>;
        if (Object.keys(requests).length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
        }
      }
      if (Object.keys(requests).length > 0) throw new Error('BatchWrite left unprocessed deletes');
    }
  }
}
