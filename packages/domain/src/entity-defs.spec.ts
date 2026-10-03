import { describe, expect, it } from 'vitest';
import { ENTITY_DEFS, ENTITY_LIST, ENTITY_NAMES, itemsOf, refOf, STATUS_ENTITY_NAMES } from './entity-defs.js';
import { isTopicKind } from './entities.js';

describe('entity table', () => {
  it('addresses each entity in the single-table layout', () => {
    expect(ENTITY_DEFS.topic.address({ id: 'a' })).toEqual({ PK: 'TOPIC#a', SK: 'TOPIC' });
    expect(ENTITY_DEFS.reference.address({ id: 'r', parentId: 'a' })).toEqual({ PK: 'TOPIC#a', SK: 'REF#r' });
    expect(ENTITY_DEFS.perspective.address({ id: 'p', parentId: 'a' })).toEqual({ PK: 'TOPIC#a', SK: 'PERSP#p' });
    expect(ENTITY_DEFS.relation.address({ id: 'x' })).toEqual({ PK: 'REL#x', SK: 'REL' });
    expect(ENTITY_DEFS.outlet.address({ id: 'npr-org' })).toEqual({ PK: 'OUTLET#npr-org', SK: 'OUTLET' });
    expect(ENTITY_DEFS.page.address({ id: 'home' })).toEqual({ PK: 'PAGE#home', SK: 'PAGE' });
  });

  it('claims exactly one entity per sort key', () => {
    for (const [sk, owner] of [['TOPIC', 'topic'], ['REF#1', 'reference'], ['PERSP#1', 'perspective'], ['REL', 'relation'], ['OUTLET', 'outlet'], ['PAGE', 'page']]) {
      expect(ENTITY_LIST.filter((d) => d.owns(sk)).map((d) => d.name)).toEqual([owner]);
    }
    expect(ENTITY_LIST.filter((d) => d.owns('SOMETHING'))).toEqual([]);
  });

  it('lists every entity, and the status ones apart from versioned pages', () => {
    expect(ENTITY_LIST.map((d) => d.name)).toEqual([...ENTITY_NAMES]);
    expect(STATUS_ENTITY_NAMES).toEqual(['topic', 'reference', 'perspective', 'relation', 'outlet']);
  });

  it('reads items and refs off a snapshot', () => {
    const snapshot = { topics: [{ id: 'a' }], references: [{ id: 'r', topicId: 'a' }], perspectives: [], relations: [] } as never;
    expect(itemsOf(snapshot, ENTITY_DEFS.reference)).toEqual([{ id: 'r', topicId: 'a' }]);
    expect(itemsOf(snapshot, ENTITY_DEFS.page)).toEqual([]); // pages are optional on a snapshot
    expect(refOf(ENTITY_DEFS.reference, { id: 'r', topicId: 'a' } as never)).toEqual({ id: 'r', parentId: 'a' });
    expect(refOf(ENTITY_DEFS.topic, { id: 'a' })).toEqual({ id: 'a', parentId: undefined });
  });
});

describe('isTopicKind', () => {
  it('accepts only known kinds', () => {
    expect(isTopicKind('case')).toBe(true);
    expect(isTopicKind('nope')).toBe(false);
    expect(isTopicKind(undefined)).toBe(false);
  });
});
