import { describe, expect, it, vi } from 'vitest';
import { InMemoryContentStore, type Outlet, type Reference, type Topic } from '@greed/domain';
import { ContentService } from '../content/content.service.js';
import { suggestMissingUrls } from './suggest.js';
import type { SearchClient, SearchHit } from './types.js';

const at = '2026-01-01T00:00:00.000Z';
const topic = (id: string, title: string): Topic => ({
  id, kind: 'case', title, summary: 's', sections: [], disputed: '', notes: '', tags: [], createdAt: at, updatedAt: at, status: 'published',
});
const outlet = (name: string, domain: string, extra: Partial<Outlet> = {}): Outlet => ({
  id: domain.replace(/\./g, '-'), name, domain, paywall: false, accuracy: 'high', bias: 'low', oneSided: false, factual: 'high', createdAt: at, updatedAt: at, status: 'published', ...extra,
});
const ref = (id: string, topicId: string, label: string, extra: Partial<Reference> = {}): Reference => ({ id, topicId, label, createdAt: at, updatedAt: at, status: 'draft', ...extra });

const outlets = [outlet('AP', 'apnews.com'), outlet('Fox News', 'foxnews.com'), outlet('CNN', 'cnn.com', { paywall: true })];

function service(references: Reference[], o: Outlet[] = outlets) {
  return new ContentService(new InMemoryContentStore({ topics: [topic('rally', 'Grand Island rally'), topic('eo', 'Executive order')], outlets: o, references }));
}
const hit = (url: string, extra: Partial<SearchHit> = {}): SearchHit => ({ title: url, url, text: 'x', ...extra });

describe('suggestMissingUrls', () => {
  it('reviews only references without a URL, ranks strong matches, and writes nothing', async () => {
    const svc = service([
      ref('r1', 'rally', 'AP', { publishedOn: '2026-10' }),
      ref('r2', 'rally', 'Courier Newsroom'),
      ref('r3', 'rally', 'AP', { url: 'https://apnews.com/already' }),
      ref('r4', 'eo', 'Fox News Digital'),
    ]);
    const search: SearchClient = {
      search: vi.fn(async (query) =>
        query.startsWith('AP')
          ? [hit('https://apnews.com/new', { publishedDate: '2026-10-05' }), hit('https://foxnews.com/other', { publishedDate: '2025-01-01' }), hit('https://apnews.com/already')]
          : [hit('https://foxnews.com/eo', { publishedDate: '2026-09-01' })],
      ),
    };
    const out = await suggestMissingUrls(svc, { search });
    expect(out).toMatchObject({ configured: true, missing: 3, checked: 3, remaining: 0 });
    const byId = Object.fromEntries(out.suggestions.map((s) => [s.referenceId, s]));
    expect(Object.keys(byId).sort()).toEqual(['r1', 'r2', 'r4']);
    expect(byId.r1!.topicTitle).toBe('Grand Island rally');
    // r3 already uses apnews.com/already, so it is not offered to r1
    expect(byId.r1!.candidates.map((c) => [c.url, c.match])).toEqual([['https://apnews.com/new', 'strong'], ['https://foxnews.com/other', 'possible']]);
    expect(byId.r4!.candidates[0]).toMatchObject({ outlet: 'Fox News', match: 'strong' });
    expect(byId.r2!.candidates.every((c) => c.match === 'possible')).toBe(true);
    expect((await svc.find('reference', 'r1') as Reference).url).toBeUndefined();
  });

  it('marks a hit possible when its date disagrees with the reference, and allows year-only and undated references', async () => {
    const svc = service([ref('a', 'rally', 'AP', { publishedOn: '2026-10' }), ref('b', 'rally', 'AP', { publishedOn: '2026' }), ref('c', 'rally', 'AP')]);
    const search: SearchClient = { search: vi.fn(async () => [hit('https://apnews.com/story', { publishedDate: '2024-03-01' }), hit('https://apnews.com/story2')]) };
    const out = await suggestMissingUrls(svc, { search });
    const m = (id: string) => out.suggestions.find((s) => s.referenceId === id)!.candidates.map((c) => c.match);
    expect(m('a')).toEqual(['possible', 'strong']);
    expect(m('b')).toEqual(['possible', 'strong']);
    expect(m('c')).toEqual(['strong', 'strong']);
  });

  it('keeps three candidates at most, and notes when there are none', async () => {
    const svc = service([ref('a', 'rally', 'AP'), ref('b', 'eo', 'Reuters')]);
    const search: SearchClient = {
      search: vi.fn(async (query) => (query.startsWith('AP') ? [1, 2, 3, 4, 5].map((n) => hit(`https://apnews.com/${n}`)) : [])),
    };
    const out = await suggestMissingUrls(svc, { search });
    expect(out.suggestions.find((s) => s.referenceId === 'a')!.candidates).toHaveLength(3);
    expect(out.suggestions.find((s) => s.referenceId === 'b')).toMatchObject({ candidates: [], note: expect.stringMatching(/No candidate/) });
  });

  it('works in batches: limit, remaining, topic filter, and clamps a silly limit', async () => {
    const refs = Array.from({ length: 6 }, (_, i) => ref(`r${i}`, i < 4 ? 'rally' : 'eo', 'AP'));
    const search: SearchClient = { search: vi.fn(async () => []) };
    const first = await suggestMissingUrls(service(refs), { search }, { limit: 2 });
    expect(first).toMatchObject({ missing: 6, checked: 2, remaining: 4 });
    expect(first.suggestions.map((s) => s.referenceId)).toEqual(['r0', 'r1']);
    const topicOnly = await suggestMissingUrls(service(refs), { search }, { topicId: 'eo', limit: 99 });
    expect(topicOnly).toMatchObject({ missing: 2, checked: 2, remaining: 0 });
    expect((await suggestMissingUrls(service(refs), { search }, { limit: 0 })).checked).toBe(6);
    expect((await suggestMissingUrls(service(refs), { search }, { limit: Number.NaN })).checked).toBe(6);
    const many = Array.from({ length: 30 }, (_, i) => ref(`m${i}`, 'rally', 'AP'));
    expect((await suggestMissingUrls(service(many), { search }, { limit: 1000 })).checked).toBe(20);
  });

  it('runs a few searches at a time, not all at once', async () => {
    let active = 0;
    let peak = 0;
    const search: SearchClient = {
      search: vi.fn(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return [];
      }),
    };
    await suggestMissingUrls(service(Array.from({ length: 12 }, (_, i) => ref(`r${i}`, 'rally', 'AP'))), { search }, { limit: 12 });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('keeps going when one search fails', async () => {
    const svc = service([ref('a', 'rally', 'Bad'), ref('b', 'rally', 'AP')]);
    const search: SearchClient = {
      search: vi.fn(async (query) => {
        if (query.startsWith('Bad')) throw new Error('timeout');
        if (query.startsWith('AP')) return [hit('https://apnews.com/ok')];
        throw 'plain';
      }),
    };
    const out = await suggestMissingUrls(svc, { search });
    expect(out.suggestions.find((s) => s.referenceId === 'a')).toMatchObject({ candidates: [], note: 'Search failed: timeout' });
    expect(out.suggestions.find((s) => s.referenceId === 'b')!.candidates).toHaveLength(1);
    const odd = await suggestMissingUrls(service([ref('c', 'rally', 'Other')]), { search });
    expect(odd.suggestions[0]!.note).toBe('Search failed: plain');
  });

  it('explains itself when search is off, every source has a URL, or no outlet is published', async () => {
    const search: SearchClient = { search: vi.fn(async () => []) };
    expect(await suggestMissingUrls(service([ref('a', 'rally', 'AP')]), {})).toMatchObject({ configured: false, missing: 1, checked: 0, remaining: 1, suggestions: [] });
    expect((await suggestMissingUrls(service([ref('a', 'rally', 'AP', { url: 'https://apnews.com/x' })]), { search })).message).toMatch(/Every reference/);
    const none = await suggestMissingUrls(service([ref('a', 'rally', 'AP')], [outlet('CNN', 'cnn.com', { paywall: true })]), { search });
    expect(none.suggestions[0]!.note).toMatch(/No published outlets/);
    expect(search.search).not.toHaveBeenCalled();
  });
});
