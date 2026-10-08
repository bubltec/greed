import { describe, expect, it } from 'vitest';
import { ACTIVITY_TYPES, browseActivity, browseTopics, pageWindow, paginate, parseActivityQuery, parseBrowseQuery, TOPIC_SORTS } from './browse.js';
import type { TopicKind } from './entities.js';
import type { ActivityEntry, TopicSummary } from './views.js';

const topic = (id: string, over: Partial<TopicSummary> = {}): TopicSummary => ({
  id, kind: 'case', title: id.toUpperCase(), summary: '', tags: [], disputed: false, status: 'published',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', counts: { references: 0, perspectives: 0, relations: 0 }, ...over,
});
const base = parseBrowseQuery({});
const ids = (r: { items: { id: string }[] }) => r.items.map((i) => i.id);

describe('parseBrowseQuery', () => {
  it('defaults: A–Z, page 1, 25 per page', () => {
    expect(base).toEqual({ q: '', kind: undefined, sort: 'title', dir: 'asc', page: 1, size: 25 });
  });

  it('starts "bigger is more interesting" sorts descending, and honours an explicit direction', () => {
    for (const sort of ['updated', 'created', 'links', 'sources', 'perspectives']) expect(parseBrowseQuery({ sort }).dir).toBe('desc');
    for (const sort of ['title', 'kind']) expect(parseBrowseQuery({ sort }).dir).toBe('asc');
    expect(parseBrowseQuery({ sort: 'links', dir: 'asc' }).dir).toBe('asc');
    expect(parseBrowseQuery({ sort: 'title', dir: 'desc' }).dir).toBe('desc');
  });

  it('ignores anything it cannot read instead of failing, so an old link still opens', () => {
    expect(parseBrowseQuery({ sort: 'DROP TABLE', dir: 'sideways', kind: 'person ', page: 'x', size: 'huge', q: ['a', 'b'] })).toEqual({ q: 'a', kind: undefined, sort: 'title', dir: 'asc', page: 1, size: 25 });
    expect(parseBrowseQuery({ page: '-4', size: '0' })).toMatchObject({ page: 1, size: 1 });
    expect(parseBrowseQuery({ page: '2.9', size: '9999' })).toMatchObject({ page: 2, size: 100 });
    expect(parseBrowseQuery({ kind: 'person', q: `  ${'x'.repeat(300)} ` }).q).toHaveLength(200);
    expect(parseBrowseQuery({ kind: 'person' }).kind).toBe('person');
    expect(parseBrowseQuery({ q: 5, sort: ['links'] })).toMatchObject({ q: '', sort: 'links' });
  });
});

describe('browseTopics', () => {
  const list = [
    topic('b', { title: 'Beta', kind: 'person', updatedAt: '2026-03-01T00:00:00Z', createdAt: '2026-01-02T00:00:00Z', counts: { references: 5, perspectives: 0, relations: 2 }, tags: ['oil'], summary: 'Pipeline money' }),
    topic('a', { title: 'alpha', kind: 'case', updatedAt: '2026-02-01T00:00:00Z', createdAt: '2026-01-03T00:00:00Z', counts: { references: 1, perspectives: 4, relations: 9 } }),
    topic('c', { title: 'Gamma', kind: 'thesis', updatedAt: '2026-04-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', counts: { references: 3, perspectives: 1, relations: 2 } }),
    topic('d', { title: 'Delta', kind: 'case', updatedAt: '2026-04-01T00:00:00Z', createdAt: '2026-01-04T00:00:00Z', counts: { references: 3, perspectives: 1, relations: 2 } }),
  ];
  const sorted = (sort: (typeof TOPIC_SORTS)[number], dir?: 'asc' | 'desc') => ids(browseTopics(list, { ...base, sort, dir: dir ?? parseBrowseQuery({ sort }).dir }));

  it('sorts by every field in both directions, case-insensitively for titles', () => {
    expect(sorted('title')).toEqual(['a', 'b', 'd', 'c']);
    expect(sorted('title', 'desc')).toEqual(['c', 'd', 'b', 'a']);
    // c and d tie on the number, so title order (Delta, Gamma) decides, in both directions
    expect(sorted('updated')).toEqual(['d', 'c', 'b', 'a']);
    expect(sorted('updated', 'asc')).toEqual(['a', 'b', 'd', 'c']);
    expect(sorted('created')).toEqual(['d', 'a', 'b', 'c']);
    expect(sorted('created', 'asc')).toEqual(['c', 'b', 'a', 'd']);
    expect(sorted('links')).toEqual(['a', 'b', 'd', 'c']);
    expect(sorted('sources')).toEqual(['b', 'd', 'c', 'a']);
    expect(sorted('perspectives')).toEqual(['a', 'd', 'c', 'b']);
    expect(sorted('kind')).toEqual(['a', 'd', 'b', 'c']);
    expect(sorted('kind', 'desc')).toEqual(['c', 'b', 'a', 'd']);
  });

  it('breaks ties by title then id so equal rows never swap between pages', () => {
    const tied = [topic('z', { title: 'Same' }), topic('y', { title: 'Same' }), topic('x', { title: 'Same' })];
    expect(ids(browseTopics(tied, { ...base, sort: 'links', dir: 'desc' }))).toEqual(['x', 'y', 'z']);
    expect(ids(browseTopics([...tied].reverse(), { ...base, sort: 'links', dir: 'desc' }))).toEqual(['x', 'y', 'z']);
  });

  it('searches every word across title, summary and tags, and counts kinds ignoring the kind filter', () => {
    const r = browseTopics(list, { ...base, q: 'PIPELINE oil' });
    expect(ids(r)).toEqual(['b']);
    expect(r.kinds).toEqual({ person: 1 });
    const filtered = browseTopics(list, { ...base, kind: 'case' });
    expect(ids(filtered)).toEqual(['a', 'd']);
    expect(filtered.kinds).toEqual({ person: 1, case: 2, thesis: 1 } satisfies Partial<Record<TopicKind, number>>);
    expect(filtered.all).toBe(4);
    expect(browseTopics(list, { ...base, q: 'nothing like this' })).toMatchObject({ items: [], total: 0, pages: 1, page: 1, all: 4 });
  });

  it('pages, clamps a page past the end, and leaves its input alone', () => {
    const many = Array.from({ length: 7 }, (_, i) => topic(`t${i}`, { title: `T${i}` }));
    const copy = [...many];
    const second = browseTopics(many, { ...base, size: 3, page: 2 });
    expect(ids(second)).toEqual(['t3', 't4', 't5']);
    expect(second).toMatchObject({ total: 7, pages: 3, page: 2, size: 3 });
    expect(ids(browseTopics(many, { ...base, size: 3, page: 99 }))).toEqual(['t6']);
    expect(browseTopics(many, { ...base, size: 3, page: 99 }).page).toBe(3);
    expect(many).toEqual(copy);
  });
});

describe('paginate', () => {
  it('always reports at least one page, even for nothing', () => {
    expect(paginate([], 1, 10)).toEqual({ items: [], total: 0, page: 1, size: 10, pages: 1 });
    expect(paginate([1, 2, 3], 0, 2)).toMatchObject({ page: 1, items: [1, 2] });
    expect(paginate([1, 2, 3, 4], 2, 2)).toMatchObject({ pages: 2, items: [3, 4] });
  });
});

describe('activity', () => {
  const e = (id: string, type: ActivityEntry['type'], at: string): ActivityEntry => ({ type, id, topicId: 't', topicTitle: 'T', label: id, updatedAt: at });
  const log = [e('e5', 'relation', '2026-05'), e('e4', 'topic', '2026-04'), e('e3', 'reference', '2026-03'), e('e2', 'reference', '2026-02'), e('e1', 'perspective', '2026-01')];

  it('parses defaults and ignores junk', () => {
    expect(parseActivityQuery({})).toEqual({ type: undefined, dir: 'desc', page: 1, size: 25 });
    expect(parseActivityQuery({ type: 'reference', dir: 'asc', page: '2', size: '10' })).toEqual({ type: 'reference', dir: 'asc', page: 2, size: 10 });
    expect(parseActivityQuery({ type: 'bogus', dir: 'up', page: 'z' })).toMatchObject({ type: undefined, dir: 'desc', page: 1 });
    expect(ACTIVITY_TYPES).toHaveLength(4);
  });

  it('keeps newest first, can reverse, filters by type and counts every type', () => {
    const q = parseActivityQuery({});
    expect(ids(browseActivity(log, q))).toEqual(['e5', 'e4', 'e3', 'e2', 'e1']);
    expect(ids(browseActivity(log, { ...q, dir: 'asc' }))).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    const refs = browseActivity(log, { ...q, type: 'reference' });
    expect(ids(refs)).toEqual(['e3', 'e2']);
    expect(refs.types).toEqual({ relation: 1, topic: 1, reference: 2, perspective: 1 });
    expect(ids(browseActivity(log, { ...q, size: 2, page: 3 }))).toEqual(['e1']);
    expect(log.map((x) => x.id)).toEqual(['e5', 'e4', 'e3', 'e2', 'e1']);
  });
});

describe('pageWindow', () => {
  it('shows every page when there are few', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps first, last and a window around the current page with gaps', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, '…', 20]);
    expect(pageWindow(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20]);
    expect(pageWindow(20, 20)).toEqual([1, '…', 17, 18, 19, 20]);
    expect(pageWindow(4, 20)).toEqual([1, 2, 3, 4, 5, '…', 20]);
    expect(pageWindow(5, 20)).toEqual([1, '…', 4, 5, 6, '…', 20]);
    expect(pageWindow(17, 20)).toEqual([1, '…', 16, 17, 18, 19, 20]);
    expect(pageWindow(16, 20)).toEqual([1, '…', 15, 16, 17, '…', 20]);
  });

  it('never returns more entries than its bound and always includes the current page', () => {
    for (const pages of [8, 9, 20, 100]) {
      for (let page = 1; page <= pages; page++) {
        const w = pageWindow(page, pages);
        expect(w.length).toBeLessThanOrEqual(7);
        expect(w).toContain(page);
        expect(w[0]).toBe(1);
        expect(w.at(-1)).toBe(pages);
        const nums = w.filter((x): x is number => x !== '…');
        expect(nums).toEqual([...nums].sort((a, b) => a - b));
        // a gap is never exactly one page
        w.forEach((x, i) => { if (x === '…') expect((w[i + 1] as number) - (w[i - 1] as number)).toBeGreaterThan(2); });
      }
    }
  });
});
