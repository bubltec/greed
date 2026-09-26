import { describe, expect, it } from 'vitest';
import type { ContentSnapshot, Topic } from './entities.js';
import { ContentIndex } from './views.js';
import { InMemoryContentStore } from './ports.js';

const at = '2026-09-01T00:00:00.000Z';
const topic = (id: string, extra: Partial<Topic> = {}): Topic => ({
  id,
  kind: 'case',
  title: id.toUpperCase(),
  summary: '',
  sections: [],
  disputed: '',
  notes: '',
  tags: [],
  createdAt: at,
  updatedAt: at,
  ...extra,
});

const snapshot: ContentSnapshot = {
  topics: [topic('a'), topic('b', { disputed: 'contested' }), topic('c')],
  references: [{ id: 'r1', topicId: 'a', label: 'NPR', createdAt: at, updatedAt: at }],
  perspectives: [
    {
      id: 'p1',
      topicId: 'b',
      stance: 'defender',
      holder: 'Agency',
      body: 'No.',
      refIds: [],
      createdAt: at,
      updatedAt: '2026-09-02T00:00:00.000Z',
    },
  ],
  relations: [
    { id: 'x', fromId: 'a', toId: 'b', kind: 'same-actor', note: '', provenance: 'sourced', createdAt: at, updatedAt: at },
    { id: 'dangling', fromId: 'a', toId: 'gone', kind: 'related', note: '', provenance: 'inferred', createdAt: at, updatedAt: at },
  ],
};

describe('ContentIndex', () => {
  const index = new ContentIndex(snapshot);

  it('counts children and ignores dangling relations', () => {
    const a = index.summaries().find((s) => s.id === 'a')!;
    expect(a.counts).toEqual({ references: 1, perspectives: 0, relations: 1 });
    expect(index.summaries().find((s) => s.id === 'b')!.disputed).toBe(true);
  });

  it('shows relations from both ends with direction', () => {
    expect(index.view('a')!.related[0]).toMatchObject({ other: { id: 'b' }, direction: 'outgoing' });
    expect(index.view('b')!.related[0]).toMatchObject({ other: { id: 'a' }, direction: 'incoming' });
    expect(index.view('nope')).toBeUndefined();
  });

  it('builds a graph without dangling edges', () => {
    expect(index.graph().edges.map((e) => e.id)).toEqual(['x']);
  });

  it('orders activity newest first', () => {
    expect(index.activity(1)[0]).toMatchObject({ type: 'perspective', topicTitle: 'B' });
  });
});

describe('InMemoryContentStore', () => {
  it('cascades a topic delete', async () => {
    const store = new InMemoryContentStore(snapshot);
    await store.deleteTopic('a');
    const after = await store.loadAll();
    expect(after.topics.map((t) => t.id)).toEqual(['b', 'c']);
    expect(after.references).toEqual([]);
    expect(after.relations).toEqual([]);
  });
});
