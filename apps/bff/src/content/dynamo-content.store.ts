import {
  BatchWriteCommand,
  DeleteCommand,
  type DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  ContentSnapshot,
  ContentStore,
  Perspective,
  Reference,
  Relation,
  Topic,
} from '@greed/domain';

/**
 * Single-table layout (see docs/data-model.md):
 *
 *   TOPIC#<id>  TOPIC          the topic
 *   TOPIC#<id>  REF#<refId>    a reference on that topic
 *   TOPIC#<id>  PERSP#<pId>    a perspective on that topic
 *   REL#<id>    REL            a relation (fromId/toId are attributes)
 *
 * Reads are one paginated Scan cached in ContentService: at a few hundred
 * rows that is cheaper and simpler than per-view queries (btfp does the same).
 */
export const keys = {
  topic: (id: string) => ({ PK: `TOPIC#${id}`, SK: 'TOPIC' }),
  reference: (topicId: string, id: string) => ({ PK: `TOPIC#${topicId}`, SK: `REF#${id}` }),
  perspective: (topicId: string, id: string) => ({ PK: `TOPIC#${topicId}`, SK: `PERSP#${id}` }),
  relation: (id: string) => ({ PK: `REL#${id}`, SK: 'REL' }),
};

type Row = Record<string, unknown> & { PK: string; SK: string; entity?: string };

function strip<T>(row: Row): T {
  const { PK: _pk, SK: _sk, entity: _entity, ...rest } = row;
  return rest as T;
}

/** Sorts raw rows into a snapshot. Unknown rows are ignored, not fatal. */
export function rowsToSnapshot(rows: Row[]): ContentSnapshot {
  const snapshot: ContentSnapshot = { topics: [], references: [], perspectives: [], relations: [] };
  for (const row of rows) {
    if (row.SK === 'TOPIC') snapshot.topics.push(strip<Topic>(row));
    else if (row.SK.startsWith('REF#')) snapshot.references.push(strip<Reference>(row));
    else if (row.SK.startsWith('PERSP#')) snapshot.perspectives.push(strip<Perspective>(row));
    else if (row.SK === 'REL') snapshot.relations.push(strip<Relation>(row));
  }
  return snapshot;
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

  private put(item: Record<string, unknown>) {
    return this.db.send(new PutCommand({ TableName: this.tableName, Item: item }));
  }

  private del(key: { PK: string; SK: string }) {
    return this.db.send(new DeleteCommand({ TableName: this.tableName, Key: key }));
  }

  async putTopic(topic: Topic) {
    await this.put({ ...keys.topic(topic.id), entity: 'topic', ...topic });
  }

  async deleteTopic(topicId: string) {
    const toDelete: { PK: string; SK: string }[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await this.db.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `TOPIC#${topicId}` },
          ProjectionExpression: 'PK, SK',
          ExclusiveStartKey,
        }),
      );
      toDelete.push(...((page.Items ?? []) as { PK: string; SK: string }[]));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    const { relations } = await this.loadAll();
    for (const r of relations) {
      if (r.fromId === topicId || r.toId === topicId) toDelete.push(keys.relation(r.id));
    }
    await this.batchDelete(toDelete);
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

  async putReference(reference: Reference) {
    await this.put({
      ...keys.reference(reference.topicId, reference.id),
      entity: 'reference',
      ...reference,
    });
  }

  async deleteReference(topicId: string, referenceId: string) {
    await this.del(keys.reference(topicId, referenceId));
  }

  async putPerspective(perspective: Perspective) {
    await this.put({
      ...keys.perspective(perspective.topicId, perspective.id),
      entity: 'perspective',
      ...perspective,
    });
  }

  async deletePerspective(topicId: string, perspectiveId: string) {
    await this.del(keys.perspective(topicId, perspectiveId));
  }

  async putRelation(relation: Relation) {
    await this.put({ ...keys.relation(relation.id), entity: 'relation', ...relation });
  }

  async deleteRelation(relationId: string) {
    await this.del(keys.relation(relationId));
  }
}
