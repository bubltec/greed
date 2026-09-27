import { describe, expect, it } from 'vitest';
import type { ContentSnapshot, Topic } from './entities.js';
import { drafts, publishedOnly } from './publishing.js';
import { ContentIndex } from './views.js';

const at = '2026-09-01T00:00:00.000Z';
const topic = (id: string, status?: 'draft' | 'published'): Topic => ({
  id,
  kind: 'case',
  title: id.toUpperCase(),
  summary: '',
  sections: [{ id: 's', label: 'S', points: [{ text: 'x', refIds: ['r-pub', 'r-draft'] }] }],
  disputed: '',
  notes: '',
  tags: [],
  createdAt: at,
  updatedAt: at,
  ...(status ? { status } : {}),
});
const stamp = { createdAt: at, updatedAt: at };

const snapshot: ContentSnapshot = {
  // `legacy` has no status at all: rows imported before publishing count as published.
  topics: [topic('legacy'), topic('live', 'published'), topic('wip', 'draft')],
  references: [
    { id: 'r-pub', topicId: 'live', label: 'NPR', ...stamp },
    { id: 'r-draft', topicId: 'live', label: 'AP', status: 'draft', ...stamp },
    { id: 'r-hidden-topic', topicId: 'wip', label: 'X', ...stamp },
  ],
  perspectives: [
    { id: 'p1', topicId: 'live', stance: 'critic', holder: 'A', body: '', refIds: ['r-draft'], status: 'published', ...stamp },
    { id: 'p2', topicId: 'live', stance: 'defender', holder: 'B', body: '', refIds: [], status: 'draft', ...stamp },
  ],
  relations: [
    { id: 'rel-ok', fromId: 'legacy', toId: 'live', kind: 'related', note: '', provenance: 'editor', ...stamp },
    { id: 'rel-to-draft', fromId: 'live', toId: 'wip', kind: 'related', note: '', provenance: 'editor', ...stamp },
    { id: 'rel-draft', fromId: 'live', toId: 'legacy', kind: 'same-actor', note: '', provenance: 'editor', status: 'draft', ...stamp },
  ],
};

describe('publishedOnly', () => {
  const pub = publishedOnly(snapshot);

  it('hides draft rows and everything hanging off draft topics', () => {
    expect(pub.topics.map((t) => t.id)).toEqual(['legacy', 'live']);
    expect(pub.references.map((r) => r.id)).toEqual(['r-pub']);
    expect(pub.perspectives.map((p) => p.id)).toEqual(['p1']);
    expect(pub.relations.map((r) => r.id)).toEqual(['rel-ok']);
  });

  it('drops citations of hidden references', () => {
    const live = pub.topics.find((t) => t.id === 'live')!;
    expect(live.sections[0]!.points[0]!.refIds).toEqual(['r-pub']);
    expect(pub.perspectives[0]!.refIds).toEqual([]);
  });

  it('backs the public ContentIndex', () => {
    const index = new ContentIndex(snapshot);
    expect(index.published().view('wip')).toBeUndefined();
    expect(index.view('wip')).toBeDefined();
    expect(index.published().summaries().every((s) => s.status === 'published')).toBe(true);
  });
});

describe('drafts', () => {
  it('lists every draft with whether its topic is live', () => {
    const list = drafts(snapshot);
    expect(list.map((d) => `${d.type}:${d.id}`).sort()).toEqual(
      ['perspective:p2', 'reference:r-draft', 'relation:rel-draft', 'topic:wip'].sort(),
    );
    expect(list.find((d) => d.id === 'r-draft')!.topicPublished).toBe(true);
    expect(list.find((d) => d.id === 'wip')!.topicPublished).toBe(false);
  });
});
