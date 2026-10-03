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
    expect(pub.outlets).toEqual([]);
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

describe('outlet drafts', () => {
  it('lists a draft outlet on its own, and hides it from the public until published', () => {
    const withOutlet: ContentSnapshot = {
      ...snapshot,
      outlets: [
        { id: 'npr-org', name: 'NPR', domain: 'npr.org', paywall: false, accuracy: 'high', bias: 'low', oneSided: false, factual: 'high', status: 'draft', ...stamp },
        { id: 'cnn-com', name: 'CNN', domain: 'cnn.com', paywall: true, accuracy: 'mixed', bias: 'mixed', oneSided: false, factual: 'mixed', status: 'published', ...stamp },
      ],
    };
    expect(drafts(withOutlet).find((d) => d.id === 'npr-org')).toMatchObject({ type: 'outlet', topicId: 'outlet:npr-org', label: 'NPR' });
    expect(publishedOnly(withOutlet).outlets?.map((o) => o.id)).toEqual(['cnn-com']);
  });
});

describe('public authorship', () => {
  it('never exposes an editor email, but keeps system writers', () => {
    const pub = publishedOnly({
      topics: [{ ...topic('live', 'published'), updatedBy: 'me@example.com (mcp)' }],
      references: [
        { id: 'r1', topicId: 'live', label: 'NPR', updatedBy: 'me@example.com', ...stamp },
        { id: 'r2', topicId: 'live', label: 'AP', updatedBy: 'link-fill', ...stamp },
      ],
      perspectives: [],
      relations: [],
      pages: [
        {
          id: 'about',
          draft: { title: 'A', body: 'b', updatedAt: at, updatedBy: 'me@example.com' },
          published: { title: 'A', body: 'b', publishedAt: at, publishedBy: 'me@example.com' },
        },
      ],
    });
    expect(pub.topics[0]!.updatedBy).toBe('editor');
    expect(pub.references.map((r) => r.updatedBy)).toEqual(['editor', 'link-fill']);
    expect(pub.pages![0]!.published!.publishedBy).toBe('editor');
    expect(JSON.stringify(pub)).not.toContain('@');
  });
});
