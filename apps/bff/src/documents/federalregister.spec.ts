import { describe, expect, it } from 'vitest';
import { FederalRegisterProvider, federalRegisterNumber } from './federalregister.js';
import type { HttpGet } from './http.js';

const API = 'https://www.federalregister.gov/api/v1';
const RAW = 'https://www.federalregister.gov/documents/full_text/text/2025/01/28/2025-01902.txt';

/** Answers by exact url; anything else is a 404. */
function http(routes: Record<string, { json?: unknown; text?: string }>, status = 200) {
  const calls: string[] = [];
  const get: HttpGet = async (url) => {
    calls.push(url);
    const hit = routes[url];
    return hit
      ? { status, json: async () => hit.json, text: async () => hit.text ?? '' }
      : { status: 404, json: async () => ({}), text: async () => '' };
  };
  return { fr: new FederalRegisterProvider(get), calls };
}

const eo = {
  title: 'Restoring Freedom of Speech and Ending Federal Censorship',
  type: 'Presidential Document',
  document_number: '2025-01902',
  publication_date: '2025-01-28',
  citation: '90 FR 8243',
  executive_order_number: '14149',
  html_url: 'https://www.federalregister.gov/documents/2025/01/28/2025-01902/restoring-freedom-of-speech',
  raw_text_url: RAW,
  agencies: [{ name: 'Executive Office of the President' }, {}],
};
const text = '<html><body><pre>\n[Federal Register Volume 90]\nBy the authority &amp; vested in me\n</pre></body></html>';

describe('federalRegisterNumber', () => {
  it('finds the document number in long and short links, and nothing else', () => {
    const n = (p: string) => federalRegisterNumber(new URL(`https://www.federalregister.gov${p}`));
    expect(n('/documents/2025/01/28/2025-01902/restoring-freedom')).toBe('2025-01902');
    expect(n('/d/2025-01902')).toBe('2025-01902');
    expect(n('/documents/2025/01/28/E9-12345/x')).toBe('E9-12345');
    expect(n('/agencies/epa')).toBeUndefined();
    expect(n('/d/not-a-number')).toBeUndefined();
    expect(n('/documents/search')).toBeUndefined();
  });
});

describe('FederalRegisterProvider', () => {
  it('reads an executive order: identifiers, agency, plain text', async () => {
    const { fr, calls } = http({ [`${API}/documents/2025-01902.json`]: { json: eo }, [RAW]: { text } });
    const doc = await fr.read(new URL('https://www.federalregister.gov/d/2025-01902'));
    expect(doc).toMatchObject({
      kind: 'order', title: eo.title, publishedOn: '2025-01-28', issuer: 'Executive Office of the President', url: eo.html_url,
      identifiers: { documentNumber: '2025-01902', citation: '90 FR 8243', executiveOrder: '14149' },
    });
    expect(doc.pages[0]!.text).toBe('[Federal Register Volume 90]\nBy the authority & vested in me');
    expect(doc.note).toBeUndefined();
    expect(calls).toEqual([`${API}/documents/2025-01902.json`, RAW]);
    expect(fr.configured()).toBe(true);
  });

  it('does not fetch a text link that leaves the Federal Register, and keeps the abstract as a note', async () => {
    const { fr, calls } = http({
      [`${API}/documents/2025-00001.json`]: { json: { title: 'A rule', type: 'Rule', abstract: 'Summary here.', raw_text_url: 'https://evil.example/x.txt', html_url: 'https://www.federalregister.gov/d/2025-00001' } },
      [`${API}/documents/2025-00002.json`]: { json: { type: 'Odd' } },
    });
    const withAbstract = await fr.read(new URL('https://www.federalregister.gov/d/2025-00001'));
    expect(withAbstract).toMatchObject({ kind: 'rule', note: 'No full text available. Abstract: Summary here.', identifiers: { documentNumber: '2025-00001' } });
    const bare = await fr.read(new URL('https://www.federalregister.gov/d/2025-00002'));
    expect(bare).toMatchObject({ kind: 'other', title: '2025-00002', url: 'https://www.federalregister.gov/d/2025-00002', note: expect.stringMatching(/no text/) });
    expect(calls.some((c) => c.includes('evil'))).toBe(false);
  });

  it('rejects links it does not understand and 404s a missing document', async () => {
    const { fr } = http({});
    await expect(fr.read(new URL('https://www.federalregister.gov/agencies/epa'))).rejects.toThrow(/not recognised/);
    expect(fr.handles(new URL('https://www.federalregister.gov/agencies/epa'))).toBe(false);
    await expect(fr.read(new URL('https://www.federalregister.gov/d/2025-99999'))).rejects.toThrow(/no such record/);
  });

  it('searches with type, date and limit filters and maps results to refs', async () => {
    const results = [
      { title: 'Refugee Admissions', html_url: 'https://www.federalregister.gov/documents/2026/10/02/2026-20318/refugee', document_number: '2026-20318', publication_date: '2026-10-02', type: 'Presidential Document', abstract: null, agency_names: ['EOP', 'DHS'], excerpts: 'the <span class="match">Immigration</span> and Nationality Act' },
      { title: 'No url', document_number: 'x' },
      { html_url: 'https://www.federalregister.gov/d/1', document_number: '2026-1', type: 'Notice', abstract: 'An abstract' },
    ];
    let asked = '';
    const get: HttpGet = async (url) => {
      asked = url;
      return { status: 200, json: async () => ({ results }), text: async () => '' };
    };
    const hits = await new FederalRegisterProvider(get).search('immigration', { kind: 'order', from: '2026-01-01', to: '2026-12-31', limit: 99 });
    const q = new URL(asked).searchParams;
    expect(q.get('conditions[term]')).toBe('immigration');
    expect(q.getAll('conditions[type][]')).toEqual(['PRESDOCU']);
    expect(q.get('conditions[publication_date][gte]')).toBe('2026-01-01');
    expect(q.get('conditions[publication_date][lte]')).toBe('2026-12-31');
    expect(q.get('per_page')).toBe('20');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ kind: 'order', issuer: 'EOP; DHS', snippet: 'the Immigration and Nationality Act', publishedOn: '2026-10-02' });
    expect(hits[1]).toMatchObject({ kind: 'notice', title: '2026-1', snippet: 'An abstract' });
  });

  it('searches every type with no kind, skips kinds it does not carry, and tolerates an empty body', async () => {
    const urls: string[] = [];
    const get: HttpGet = async (url) => {
      urls.push(url);
      return { status: 200, json: async () => ({}), text: async () => '' };
    };
    const fr = new FederalRegisterProvider(get);
    expect(await fr.search('x', {})).toEqual([]);
    expect(new URL(urls[0]!).searchParams.getAll('conditions[type][]')).toEqual([]);
    expect(await fr.search('x', { kind: 'opinion' })).toEqual([]);
    expect(urls).toHaveLength(1);
  });

  it('reports upstream errors', async () => {
    await expect(http({ [`${API}/documents/2025-01902.json`]: { json: {} } }, 500).fr.read(new URL('https://www.federalregister.gov/d/2025-01902'))).rejects.toThrow(/returned 500/);
  });
});
