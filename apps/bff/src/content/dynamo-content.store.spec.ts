import { describe, expect, it } from 'vitest';
import { keys, rowsToSnapshot } from './dynamo-content.store.js';

describe('rowsToSnapshot', () => {
  it('routes rows by sort key and strips key attributes', () => {
    const snap = rowsToSnapshot([
      { ...keys.topic('a'), entity: 'topic', id: 'a', title: 'A' },
      { ...keys.reference('a', 'r1'), entity: 'reference', id: 'r1', topicId: 'a' },
      { ...keys.perspective('a', 'p1'), entity: 'perspective', id: 'p1', topicId: 'a' },
      { ...keys.relation('x'), entity: 'relation', id: 'x', fromId: 'a', toId: 'b' },
      { PK: 'SOMETHING', SK: 'ELSE' },
    ]);
    expect(snap.topics).toEqual([{ id: 'a', title: 'A' }]);
    expect(snap.references).toHaveLength(1);
    expect(snap.perspectives).toHaveLength(1);
    expect(snap.relations).toEqual([{ id: 'x', fromId: 'a', toId: 'b' }]);
  });
});
