import { describe, expect, it } from 'vitest';
import { CourtListenerProvider } from './courtlistener.js';
import { FederalRegisterProvider } from './federalregister.js';
import { GovInfoProvider } from './govinfo.js';
import type { HttpGet } from './http.js';
import { DocumentProviders } from './registry.js';
import type { DocumentProvider } from './types.js';

/**
 * Rules every provider must keep, whatever it wraps. Each case wires a provider
 * to a fake that answers any request with a plausible body and records the host,
 * so the checks run on the real adapters.
 */
interface Case {
  name: string;
  make(get: HttpGet): DocumentProvider;
  /** A public link the provider reads. */
  readable: string;
}

const body = (url: string) => {
  if (url.includes('/search')) return { results: [] };
  if (url.includes('/documents/')) return { title: 'T', type: 'Rule', document_number: '2025-01902', publication_date: '2025-01-28', raw_text_url: 'https://www.federalregister.gov/documents/full_text/text/2025/01/28/2025-01902.txt' };
  if (url.includes('/clusters/')) return { case_name: 'A v. B', sub_opinions: [] };
  return { title: 'T', collectionCode: 'CHRG', results: [] };
};
const fake = (seen: string[]): HttpGet => async (url) => {
  seen.push(url);
  return { status: 200, json: async () => body(url), text: async () => '<pre>some text</pre>' };
};

const cases: Case[] = [
  { name: 'courtlistener', make: (get) => new CourtListenerProvider(() => 'tok', get), readable: 'https://www.courtlistener.com/opinion/12/a-v-b/' },
  { name: 'federalregister', make: (get) => new FederalRegisterProvider(get), readable: 'https://www.federalregister.gov/d/2025-01902' },
  { name: 'govinfo', make: (get) => new GovInfoProvider(() => 'key', get), readable: 'https://www.govinfo.gov/app/details/CHRG-119shrg60276' },
];

describe.each(cases)('provider contract: $name', ({ make, readable }) => {
  const hostOk = (p: DocumentProvider, url: string) => {
    const host = new URL(url).hostname;
    return p.hosts.some((h) => host === h || host.endsWith(`.${h}`));
  };

  it('identifies itself and what it reads', () => {
    const p = make(fake([]));
    expect(p.id).toMatch(/^[a-z]+$/);
    expect(p.name).toBeTruthy();
    expect(p.hosts.length).toBeGreaterThan(0);
    expect(p.kinds.length).toBeGreaterThan(0);
    expect(p.configured()).toBe(true);
    expect(p.handles(new URL(readable))).toBe(true);
  });

  it('claims no link on a host it does not own through the registry, and never reads one', async () => {
    const seen: string[] = [];
    const registry = new DocumentProviders([make(fake(seen))]);
    const hostile = [
      'https://169.254.169.254/latest/meta-data/',
      'http://localhost:3000/opinion/12/x/',
      `https://evil.example/${new URL(readable).pathname}`,
      `https://${new URL(readable).hostname}.evil.example/`,
      `https://evil.example/?u=${encodeURIComponent(readable)}`,
    ];
    for (const url of hostile) await expect(registry.read(url), url).rejects.toThrow();
    expect(seen).toEqual([]);
  });

  it('reads its own link into numbered pages with matching provider and host, calling only its own hosts', async () => {
    const seen: string[] = [];
    const p = make(fake(seen));
    const doc = await p.read(new URL(readable));
    expect(doc.provider).toBe(p.id);
    expect(hostOk(p, doc.url)).toBe(true);
    expect(doc.title).toBeTruthy();
    expect(doc.pages.length).toBeGreaterThan(0);
    expect(doc.pages.map((x) => x.page)).toEqual(doc.pages.map((_, i) => i + 1));
    expect(doc.identifiers).toBeTypeOf('object');
    expect(Array.isArray(doc.related)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((u) => u.startsWith('https://') && hostOk(p, u))).toBe(true);
  });

  it('searches only its own hosts and returns refs it can be asked to read back', async () => {
    const seen: string[] = [];
    const p = make(fake(seen));
    const hits = await p.search('anything', { limit: 3 });
    expect(Array.isArray(hits)).toBe(true);
    expect(seen.every((u) => hostOk(p, u))).toBe(true);
    for (const h of hits) {
      expect(h.provider).toBe(p.id);
      expect(hostOk(p, h.url)).toBe(true);
    }
  });

  it('rejects a link on its host that it does not understand', async () => {
    const p = make(fake([]));
    const other = new URL(`https://${p.hosts[0]}/about`);
    expect(p.handles(other)).toBe(false);
    await expect(p.read(other)).rejects.toThrow();
  });
});
