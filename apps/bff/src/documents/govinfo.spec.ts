import { describe, expect, it } from 'vitest';
import { GovInfoProvider, parseGovInfoUrl } from './govinfo.js';
import type { HttpGet } from './http.js';

const API = 'https://api.govinfo.gov';

/** Shapes copied from live api.govinfo.gov responses (search and package summary). */
const CREC_HIT = {
  title: 'PUBLIC BILLS AND RESOLUTIONS',
  packageId: 'CREC-2026-10-01',
  granuleId: 'CREC-2026-10-01-pt1-PgH6015-2',
  governmentAuthor: ['Congress'],
  dateIssued: '2026-10-01',
  collectionCode: 'CREC',
};
const CHRG_HIT = {
  title: 'Military Construction and Veterans Affairs, and Related Agencies Appropriations for Fiscal Year 2026',
  packageId: 'CHRG-119shrg60276',
  granuleId: 'CHRG-119shrg60276',
  governmentAuthor: ['Congress', 'Senate'],
  dateIssued: '2026-09-30',
  collectionCode: 'CHRG',
};
const CHRG_SUMMARY = {
  title: 'MILITARY CONSTRUCTION AND VETERANS AFFAIRS, AND RELATED AGENCIES APPROPRIATIONS FOR FISCAL YEAR 2026',
  collectionCode: 'CHRG',
  docClass: 'SHRG',
  congress: '119',
  pages: '114',
  chamber: 'SENATE',
  suDocClassNumber: 'Y 4.AP 6/2:S.HRG.119-70',
  governmentAuthor1: 'Congress',
  governmentAuthor2: 'Senate',
  dateIssued: '2026-09-30',
};

interface Call {
  url: string;
  method?: string;
  body?: string;
  key?: string;
}
function http(routes: Record<string, { json?: unknown; text?: string; status?: number }>) {
  const calls: Call[] = [];
  const get: HttpGet = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body, key: init.headers['X-Api-Key'] });
    const hit = routes[url];
    if (!hit) return { status: 404, json: async () => ({}), text: async () => '' };
    return { status: hit.status ?? 200, json: async () => hit.json, text: async () => hit.text ?? '' };
  };
  return { calls, get };
}
const provider = (routes: Record<string, { json?: unknown; text?: string; status?: number }>, key: string | undefined = 'k') => {
  const h = http(routes);
  return { gi: new GovInfoProvider(() => key, h.get), ...h };
};

describe('parseGovInfoUrl', () => {
  const t = (u: string) => parseGovInfoUrl(new URL(u));
  it('reads details and content links, with or without a granule', () => {
    expect(t('https://www.govinfo.gov/app/details/CHRG-119shrg60276')).toEqual({ packageId: 'CHRG-119shrg60276' });
    expect(t('https://www.govinfo.gov/app/details/CREC-2026-10-01/CREC-2026-10-01-pt1-PgH6015-2')).toEqual({ packageId: 'CREC-2026-10-01', granuleId: 'CREC-2026-10-01-pt1-PgH6015-2' });
    expect(t('https://www.govinfo.gov/content/pkg/CREC-2026-10-01/html/CREC-2026-10-01-pt1-PgH6015-2.htm')).toEqual({ packageId: 'CREC-2026-10-01', granuleId: 'CREC-2026-10-01-pt1-PgH6015-2' });
    expect(t('https://www.govinfo.gov/content/pkg/CHRG-119shrg60276/html/CHRG-119shrg60276.htm')).toEqual({ packageId: 'CHRG-119shrg60276' });
    expect(t('https://www.govinfo.gov/content/pkg/CHRG-119shrg60276/pdf')).toEqual({ packageId: 'CHRG-119shrg60276' });
  });

  it('refuses other pages and ids that could change the API path', () => {
    for (const bad of [
      'https://www.govinfo.gov/',
      'https://www.govinfo.gov/app/collection/crec',
      'https://www.govinfo.gov/app/details/',
      'https://www.govinfo.gov/app/details/..%2f..%2fcollections',
      'https://www.govinfo.gov/app/details/CREC-1/..',
      'https://www.govinfo.gov/app/details/CREC-1/a%2fb',
      'https://www.govinfo.gov/app/details/CREC-1%3fx=1',
      'https://www.govinfo.gov/content/pkg/CREC-1',
    ]) {
      expect(t(bad), bad).toBeUndefined();
    }
  });
});

describe('GovInfoProvider.search', () => {
  it('posts one query, sends the key in a header not the url, and maps hits to refs', async () => {
    const { gi, calls } = provider({ [`${API}/search`]: { json: { count: 2, results: [CREC_HIT, CHRG_HIT, { title: 'bad id', packageId: '../x' }, { title: 'no id' }] } } });
    const hits = await gi.search('immigration', { limit: 99, from: '2026-01-01', to: '2026-12-31' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: `${API}/search`, method: 'POST', key: 'k' });
    expect(calls[0]!.url).not.toContain('api_key');
    const body = JSON.parse(calls[0]!.body!);
    expect(body).toMatchObject({ pageSize: 20, offsetMark: '*', historical: true });
    expect(body.query).toBe('collection:(BILLS OR CREC OR CHRG OR CRPT OR CDOC OR CMR OR USCOURTS) (immigration) publishdate:range(2026-01-01,2026-12-31)');
    expect(hits).toEqual([
      { provider: 'govinfo', id: 'CREC-2026-10-01-pt1-PgH6015-2', url: 'https://www.govinfo.gov/app/details/CREC-2026-10-01/CREC-2026-10-01-pt1-PgH6015-2', title: 'PUBLIC BILLS AND RESOLUTIONS', kind: 'record', publishedOn: '2026-10-01', issuer: 'Congress' },
      { provider: 'govinfo', id: 'CHRG-119shrg60276', url: 'https://www.govinfo.gov/app/details/CHRG-119shrg60276', title: CHRG_HIT.title, kind: 'hearing', publishedOn: '2026-09-30', issuer: 'Congress; Senate' },
    ]);
  });

  it('limits the collections by kind, leaves dates open on one side, and skips kinds it does not carry', async () => {
    const { gi, calls } = provider({ [`${API}/search`]: { json: { results: [] } } });
    await gi.search('x', { kind: 'bill', from: '2026-06-01' });
    await gi.search('x', { kind: 'hearing', to: '2026-06-01', limit: 0 });
    const [a, b] = calls.map((c) => JSON.parse(c.body!));
    expect(a.query).toBe('collection:(BILLS) (x) publishdate:range(2026-06-01,9999-12-31)');
    expect(b.query).toBe('collection:(CHRG) (x) publishdate:range(1000-01-01,2026-06-01)');
    expect(b.pageSize).toBe(1);
    expect(await gi.search('x', { kind: 'rule' })).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('tolerates an empty body and unknown collections', async () => {
    const { gi } = provider({ [`${API}/search`]: { json: { results: [{ packageId: 'ABC-1', title: 'Odd', collectionCode: 'ZZZ' }, { packageId: 'ABC-2' }] } } });
    const hits = await gi.search('x', {});
    expect(hits.map((h) => [h.kind, h.title, h.issuer])).toEqual([['other', 'Odd', undefined], ['other', 'ABC-2', undefined]]);
    const empty = provider({ [`${API}/search`]: { json: {} } });
    expect(await empty.gi.search('x', {})).toEqual([]);
  });
});

describe('GovInfoProvider.read', () => {
  const html = '<html><body><pre>\nSENATE HEARING\n\nMr. CHAIRMAN &amp; members\n</pre></body></html>';

  it('reads a package: summary metadata and the text rendition', async () => {
    const { gi, calls } = provider({
      [`${API}/packages/CHRG-119shrg60276/summary`]: { json: CHRG_SUMMARY },
      [`${API}/packages/CHRG-119shrg60276/htm`]: { text: html },
    });
    const doc = await gi.read(new URL('https://www.govinfo.gov/app/details/CHRG-119shrg60276'));
    expect(doc).toMatchObject({
      provider: 'govinfo', id: 'CHRG-119shrg60276', kind: 'hearing', publishedOn: '2026-09-30', issuer: 'Congress; Senate',
      url: 'https://www.govinfo.gov/app/details/CHRG-119shrg60276',
      identifiers: { packageId: 'CHRG-119shrg60276', congress: '119', docClass: 'SHRG', suDocClass: 'Y 4.AP 6/2:S.HRG.119-70', pages: '114' },
    });
    expect(doc.pages[0]!.text).toBe('SENATE HEARING\n\nMr. CHAIRMAN & members');
    expect(doc.note).toBeUndefined();
    expect(calls.map((c) => c.url)).toEqual([`${API}/packages/CHRG-119shrg60276/summary`, `${API}/packages/CHRG-119shrg60276/htm`]);
    expect(calls.every((c) => c.key === 'k' && !c.url.includes('api_key'))).toBe(true);
  });

  it('reads a granule using its own title and date, and survives a missing granule summary', async () => {
    const base = `${API}/packages/CREC-2026-10-01`;
    const g = 'CREC-2026-10-01-pt1-PgH6015-2';
    const withSummary = provider({
      [`${base}/summary`]: { json: { title: 'Congressional Record Volume 172', collectionCode: 'CREC', dateIssued: '2026-10-01' } },
      [`${base}/granules/${g}/summary`]: { json: { title: 'PUBLIC BILLS AND RESOLUTIONS', dateIssued: '2026-10-02' } },
      [`${base}/granules/${g}/htm`]: { text: '<pre>text</pre>' },
    });
    const doc = await withSummary.gi.read(new URL(`https://www.govinfo.gov/content/pkg/CREC-2026-10-01/html/${g}.htm`));
    expect(doc).toMatchObject({ id: g, title: 'PUBLIC BILLS AND RESOLUTIONS', kind: 'record', publishedOn: '2026-10-02', url: `https://www.govinfo.gov/app/details/CREC-2026-10-01/${g}`, identifiers: { packageId: 'CREC-2026-10-01', granuleId: g } });
    const without = provider({ [`${base}/summary`]: { json: { title: 'Volume', collectionCode: 'CREC', dateIssued: '2026-10-01' } }, [`${base}/granules/${g}/htm`]: { text: 'x' } });
    const fallback = await without.gi.read(new URL(`https://www.govinfo.gov/app/details/CREC-2026-10-01/${g}`));
    expect(fallback).toMatchObject({ title: 'Volume', publishedOn: '2026-10-01' });
  });

  it('falls back to the chamber, notes a missing rendition, and cuts very long text', async () => {
    const empty = provider({ [`${API}/packages/X-1/summary`]: { json: { chamber: 'HOUSE' } }, [`${API}/packages/X-1/htm`]: { text: '  ' } });
    expect(await empty.gi.read(new URL('https://www.govinfo.gov/app/details/X-1'))).toMatchObject({ title: 'X-1', kind: 'other', issuer: 'HOUSE', note: expect.stringMatching(/no text rendition/) });
    const huge = provider({ [`${API}/packages/X-2/summary`]: { json: {} }, [`${API}/packages/X-2/htm`]: { text: 'a'.repeat(2_000_100) } });
    const doc = await huge.gi.read(new URL('https://www.govinfo.gov/app/details/X-2'));
    expect(doc.note).toMatch(/cut at 2,000,000/);
    expect(doc.pages[0]!.text).toHaveLength(2_000_000);
  });

  it('errors clearly for a missing record, rate limit, bad link or missing key, and makes no call without a key', async () => {
    await expect(provider({}).gi.read(new URL('https://www.govinfo.gov/app/details/NOPE-1'))).rejects.toThrow(/no such record/);
    await expect(provider({ [`${API}/packages/A-1/summary`]: { status: 429 } }).gi.read(new URL('https://www.govinfo.gov/app/details/A-1'))).rejects.toThrow(/rate limit/);
    await expect(provider({}).gi.read(new URL('https://www.govinfo.gov/collections'))).rejects.toThrow(/not recognised/);
    const none = provider({}, '');
    expect(none.gi.configured()).toBe(false);
    await expect(none.gi.read(new URL('https://www.govinfo.gov/app/details/A-1'))).rejects.toThrow(/not configured/);
    await expect(none.gi.search('x', {})).rejects.toThrow(/not configured/);
    expect(none.calls).toEqual([]);
  });
});
