import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENTITY_DEFS } from '@greed/domain';
import { fakeDynamo } from '../fake-dynamo.testing.js';
import { DynamoContentStore, rowsToSnapshot } from './dynamo-content.store.js';

describe('rowsToSnapshot', () => {
  it('routes rows by sort key and strips key attributes', () => {
    const snap = rowsToSnapshot([
      { ...ENTITY_DEFS.topic.address({ id: 'a' }), entity: 'topic', id: 'a', title: 'A' },
      { ...ENTITY_DEFS.reference.address({ id: 'r1', parentId: 'a' }), entity: 'reference', id: 'r1', topicId: 'a' },
      { ...ENTITY_DEFS.perspective.address({ id: 'p1', parentId: 'a' }), entity: 'perspective', id: 'p1', topicId: 'a' },
      { ...ENTITY_DEFS.relation.address({ id: 'x' }), entity: 'relation', id: 'x', fromId: 'a', toId: 'b' },
      { PK: 'SOMETHING', SK: 'ELSE' },
    ]);
    expect(snap.topics).toEqual([{ id: 'a', title: 'A' }]);
    expect(snap.references).toHaveLength(1);
    expect(snap.perspectives).toHaveLength(1);
    expect(snap.relations).toEqual([{ id: 'x', fromId: 'a', toId: 'b' }]);
  });
});

const at = '2026-01-01T00:00:00.000Z';
const topic = (id: string) =>
  ({ id, kind: 'case', title: id, summary: '', sections: [], disputed: '', notes: '', tags: [], createdAt: at, updatedAt: at }) as never;

describe('DynamoContentStore', () => {
  afterEach(() => vi.useRealTimers());

  it('writes each entity under its table address and reads everything back, across scan pages', async () => {
    const { db, rows } = fakeDynamo({ pageSize: 1 });
    const store = new DynamoContentStore(db, 'content');
    await store.put('topic', topic('a'));
    await store.put('reference', { id: 'r1', topicId: 'a', label: 'NPR' } as never);
    await store.put('perspective', { id: 'p1', topicId: 'a' } as never);
    await store.put('relation', { id: 'x', fromId: 'a', toId: 'b' } as never);
    await store.put('page', { id: 'home', draft: {} } as never);
    expect([...rows.values()].map((r) => [r.PK, r.SK, r.entity])).toEqual([
      ['TOPIC#a', 'TOPIC', 'topic'],
      ['TOPIC#a', 'REF#r1', 'reference'],
      ['TOPIC#a', 'PERSP#p1', 'perspective'],
      ['REL#x', 'REL', 'relation'],
      ['PAGE#home', 'PAGE', 'page'],
    ]);
    const snapshot = await store.loadAll();
    expect(snapshot.topics.map((t) => t.id)).toEqual(['a']);
    expect(snapshot.references).toEqual([{ id: 'r1', topicId: 'a', label: 'NPR' }]);
    expect(snapshot.pages).toHaveLength(1);
  });

  it('deletes in batches of 25', async () => {
    const { db, rows, commands } = fakeDynamo();
    const store = new DynamoContentStore(db, 'content');
    for (let i = 0; i < 30; i++) await store.put('relation', { id: `r${i}`, fromId: 'a', toId: 'b' } as never);
    await store.remove([...Array(30).keys()].map((i) => ({ entity: 'relation' as const, ref: { id: `r${i}` } })));
    expect(rows.size).toBe(0);
    expect(commands.filter((c) => c === 'BatchWriteCommand')).toHaveLength(2);
  });

  it('retries unprocessed deletes with backoff', async () => {
    vi.useFakeTimers();
    const { db, rows } = fakeDynamo({ unprocessedRounds: 2 });
    const store = new DynamoContentStore(db, 'content');
    await store.put('topic', topic('a'));
    const done = store.remove([{ entity: 'topic', ref: { id: 'a' } }]);
    await vi.runAllTimersAsync();
    await done;
    expect(rows.size).toBe(0);
  });

  it('gives up when deletes stay unprocessed', async () => {
    vi.useFakeTimers();
    const { db } = fakeDynamo({ unprocessedRounds: 99 });
    const store = new DynamoContentStore(db, 'content');
    const failed = expect(store.remove([{ entity: 'topic', ref: { id: 'a' } }])).rejects.toThrow(/unprocessed/);
    await vi.runAllTimersAsync();
    await failed;
  });
});

