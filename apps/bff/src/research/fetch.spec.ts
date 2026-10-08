import { describe, expect, it, vi } from 'vitest';
import { InMemoryContentStore, type Outlet, type Topic } from '@greed/domain';
import { ContentService } from '../content/content.service.js';
import { fetchSource } from './fetch.js';
import { parseSearchHits } from './gateway.js';
import type { SearchClient } from './types.js';

const at = '2026-01-01T00:00:00.000Z';
const topic: Topic = {
  id: 'rally', kind: 'case', title: 'Grand Island rally', summary: 's', sections: [], disputed: '', notes: '', tags: [],
  createdAt: at, updatedAt: at, status: 'published',
};
const outlet = (name: string, domain: string, extra: Partial<Outlet> = {}): Outlet => ({
  id: domain.replace(/\./g, '-'), name, domain, paywall: false, accuracy: 'high', bias: 'low', oneSided: false, factual: 'high',
  createdAt: at, updatedAt: at, status: 'published', ...extra,
});
const outlets = [outlet('AP', 'apnews.com'), outlet('Fox', 'foxnews.com', { accuracy: 'mixed' }), outlet('CNN', 'cnn.com', { paywall: true }), outlet('Draft', 'draft.org', { status: 'draft' })];

async function service() {
  const svc = new ContentService(new InMemoryContentStore({ topics: [topic], outlets }));
  await svc.create('reference', { label: 'AP', url: 'https://apnews.com/article/seen' }, 'ed', 'rally');
  return svc;
}

describe('fetchSource', () => {
  it('returns the page, its outlet, who cites it, and related pages that are new', async () => {
    const search: SearchClient = {
      search: vi.fn(async (query, _max, filter) =>
        filter.include.length === 1
          ? [{ title: 'Rally story', url: 'https://www.apnews.com/article/new/?utm=1#top', text: 'Long passage', publishedDate: '2026-10-05' }]
          : [
              { title: 'self', url: 'https://apnews.com/article/new', text: 'x' },
              { title: 'seen', url: 'https://apnews.com/article/seen', text: 'x' },
              { title: 'fox', url: 'https://www.foxnews.com/politics/rally', text: 'x' },
              { title: 'off list', url: 'https://example.com/a', text: 'x' },
              { title: 'bad', url: 'not a url', text: 'x' },
            ],
      ),
    };
    const out = await fetchSource(await service(), 'https://apnews.com/article/new', ' what was said ', { search });
    expect(out).toMatchObject({ found: true, title: 'Rally story', publishedDate: '2026-10-05', text: 'Long passage' });
    expect(out.outlet).toMatchObject({ name: 'AP', accuracy: 'high' });
    expect(out.related.map((r) => [r.url, r.outlet])).toEqual([['https://www.foxnews.com/politics/rally', 'Fox']]);
    const first = (search.search as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(first[0]).toBe('what was said https://apnews.com/article/new');
    expect(first[2]).toEqual({ include: ['apnews.com'], exclude: [] });
    expect(first[3]).toEqual({ maxText: 4000 });
  });

  it('reports which topics already cite the url', async () => {
    const search: SearchClient = { search: vi.fn(async () => [{ title: '', url: 'https://apnews.com/article/seen', text: 'x' }]) };
    const out = await fetchSource(await service(), 'https://apnews.com/article/seen', undefined, { search });
    expect(out.citedOn).toMatchObject([{ topicId: 'rally', title: 'Grand Island rally' }]);
    expect(out.related).toEqual([]);
    expect(search.search).toHaveBeenCalledTimes(1);
  });

  it('says so when Web Search has no copy of the page', async () => {
    const search: SearchClient = { search: vi.fn(async () => [{ title: 'other', url: 'https://apnews.com/other', text: 'x' }]) };
    const out = await fetchSource(await service(), 'https://apnews.com/article/missing', undefined, { search });
    expect(out.found).toBe(false);
    expect(out.message).toMatch(/no copy/);
  });

  it('refuses non-http urls, paywalled hosts, unpublished or unknown hosts, and does not search', async () => {
    const search: SearchClient = { search: vi.fn() };
    const svc = await service();
    expect((await fetchSource(svc, 'javascript:alert(1)', undefined, { search })).message).toMatch(/http/);
    expect((await fetchSource(svc, 'ftp://apnews.com/x', undefined, { search })).message).toMatch(/http/);
    const paywalled = await fetchSource(svc, 'https://www.cnn.com/x', undefined, { search });
    expect(paywalled.message).toMatch(/paywalled/);
    expect(paywalled.outlet?.name).toBe('CNN');
    expect((await fetchSource(svc, 'https://draft.org/x', undefined, { search })).message).toMatch(/not a published/);
    expect((await fetchSource(svc, 'https://unknown.example/x', undefined, { search })).message).toMatch(/not a published/);
    expect(search.search).not.toHaveBeenCalled();
  });

  it('reports when web search is not configured', async () => {
    const out = await fetchSource(await service(), 'https://apnews.com/x', undefined, {});
    expect(out).toMatchObject({ configured: false, found: false });
  });
});

describe('parseSearchHits maxText', () => {
  it('keeps 500 characters by default and more when asked', () => {
    const result = { content: [{ type: 'text', text: JSON.stringify({ results: [{ title: 't', url: 'https://a.com', text: 'x'.repeat(5000) }] }) }] };
    expect(parseSearchHits(result)[0]!.text).toHaveLength(500);
    expect(parseSearchHits(result, 4000)[0]!.text).toHaveLength(4000);
  });
});
