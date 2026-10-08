import { describe, expect, it, vi } from 'vitest';
import { CourtListenerProvider, parseCourtListenerUrl, type HttpGet } from './courtlistener.js';
import { present } from './present.js';
import { DocumentProviders } from './registry.js';
import { findQuote, paginate, plain, referenceDraft } from './text.js';
import { liveDocuments } from './index.js';
import type { DocumentProvider, SourceDocument } from './types.js';

const API = 'https://www.courtlistener.com/api/rest/v4';

/** Answers by path; anything else is a 404. Records what was asked and with which header. */
function http(routes: Record<string, unknown>, status = 200) {
  const calls: { url: string; auth: string }[] = [];
  const get: HttpGet = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization! });
    const key = Object.keys(routes).find((k) => url === `${API}${k}`);
    return key ? { status, json: async () => routes[key] } : { status: 404, json: async () => ({}) };
  };
  return { get, calls };
}
const provider = (routes: Record<string, unknown>, token: string | undefined = 'tok', status = 200) => {
  const h = http(routes, status);
  return { cl: new CourtListenerProvider(() => token, h.get), ...h };
};

describe('text helpers', () => {
  it('turns html into plain text', () => {
    expect(plain('<p>Hello&nbsp;&amp; <b>bye</b></p><script>x()</script><br/>Next &weird;')).toBe('Hello & bye\n\nNext &weird;');
  });

  it('paginates on form feeds and drops trailing blanks', () => {
    expect(paginate('one\fTwo\f\f')).toEqual([{ page: 1, text: 'one' }, { page: 2, text: 'Two' }]);
    expect(paginate('')).toEqual([{ page: 1, text: '' }]);
  });

  it('finds a quote ignoring case, curly quotes, dashes and line breaks, and across a page break', () => {
    const pages = [{ page: 1, text: 'The court said\n“We hold”  that it’s lawful – and final' }, { page: 2, text: 'second page begins here' }];
    expect(findQuote(pages, 'we hold" that IT\'S lawful - and final')).toEqual([1]);
    expect(findQuote(pages, 'and final second page')).toEqual([1, 2]);
    expect(findQuote(pages, 'never said')).toEqual([]);
    expect(findQuote(pages, '   ')).toEqual([]);
  });

  it('drafts a reference from a document', () => {
    const doc = { title: 'US v. Doe', identifiers: { docketNumber: '1:26-cr-1' }, issuer: 'dcd', url: 'https://x', publishedOn: '2026-10-05' } as unknown as SourceDocument;
    expect(referenceDraft(doc)).toEqual({ label: 'US v. Doe, 1:26-cr-1, dcd', url: 'https://x', publishedOn: '2026-10' });
    expect(referenceDraft({ title: 'T', identifiers: {}, url: 'https://y' } as unknown as SourceDocument)).toEqual({ label: 'T', url: 'https://y' });
  });
});

describe('parseCourtListenerUrl', () => {
  it('understands opinions, dockets and filings and nothing else', () => {
    const t = (p: string) => parseCourtListenerUrl(new URL(`https://www.courtlistener.com${p}`));
    expect(t('/opinion/12/some-case/')).toEqual({ type: 'opinion', clusterId: '12' });
    expect(t('/docket/34/us-v-doe/')).toEqual({ type: 'docket', docketId: '34' });
    expect(t('/docket/34/7/us-v-doe/')).toEqual({ type: 'filing', docketId: '34', number: '7' });
    expect(t('/person/9/')).toBeUndefined();
    expect(t('/opinion/abc/x/')).toBeUndefined();
  });
});

describe('CourtListenerProvider', () => {
  it('reads an opinion: text from plain_text or html, citation, docket number, court', async () => {
    const { cl, calls } = provider({
      '/clusters/12/': {
        case_name: 'Doe v. Roe',
        date_filed: '2025-03-04',
        docket: `${API}/dockets/5/`,
        citations: [{ volume: 600, reporter: 'U.S.', page: 1 }],
        sub_opinions: [`${API}/opinions/1/`, `${API}/opinions/2/`],
      },
      '/dockets/5/': { docket_number: '24-1', court_id: 'scotus' },
      '/opinions/1/': { type: '020lead', plain_text: 'Majority.\fPage two.' },
      '/opinions/2/': { type: '040dissent', plain_text: '', html_with_citations: '<p>Dissent &amp; more</p>' },
    });
    const doc = await cl.read(new URL('https://www.courtlistener.com/opinion/12/doe-v-roe/'));
    expect(doc).toMatchObject({ kind: 'opinion', title: 'Doe v. Roe', publishedOn: '2025-03-04', issuer: 'scotus', identifiers: { citation: '600 U.S. 1', docketNumber: '24-1' } });
    expect(doc.pages.map((p) => p.text).join('|')).toContain('Dissent & more');
    expect(doc.pages).toHaveLength(2);
    expect(calls.every((c) => c.auth === 'Token tok')).toBe(true);
    expect(calls.every((c) => c.url.startsWith(`${API}/`))).toBe(true);
  });

  it('notes an opinion with no text and tolerates a missing docket', async () => {
    const { cl } = provider({ '/clusters/9/': { case_name_full: 'Full Name', sub_opinions: [] } });
    const doc = await cl.read(new URL('https://www.courtlistener.com/opinion/9/x/'));
    expect(doc).toMatchObject({ title: 'Full Name', identifiers: {}, note: expect.stringMatching(/no text/) });
    const fallback = provider({ '/clusters/8/': { docket: `${API}/dockets/404/`, sub_opinions: [`${API}/opinions/3/`] }, '/opinions/3/': { html: '<i>x</i>' } });
    expect((await fallback.cl.read(new URL('https://www.courtlistener.com/opinion/8/x/'))).title).toBe('Opinion 8');
  });

  it('refuses opinion links that leave the API', async () => {
    const { cl } = provider({ '/clusters/1/': { sub_opinions: ['https://evil.example/opinions/1/'] } });
    await expect(cl.read(new URL('https://www.courtlistener.com/opinion/1/x/'))).rejects.toThrow(/outside its API/);
  });

  it('reads a docket and lists the filings that have text', async () => {
    const { cl } = provider({
      '/dockets/34/': { case_name: 'US v. Doe', docket_number: '1:26-cr-1', court_id: 'dcd', date_filed: '2026-01-02', absolute_url: '/docket/34/us-v-doe/' },
      [`/docket-entries/?docket=34&order_by=entry_number`]: {
        results: [
          { entry_number: 1, date_filed: '2026-01-02', description: 'Indictment', recap_documents: [{ id: 99, document_number: '1', short_description: 'Indictment', is_available: true }, { id: 100, document_number: '1', attachment_number: 1, is_available: true }] },
          { entry_number: 2, description: 'Sealed', recap_documents: [{ id: 101, document_number: '2', is_available: false }] },
        ],
      },
    });
    const doc = await cl.read(new URL('https://www.courtlistener.com/docket/34/us-v-doe/'));
    expect(doc).toMatchObject({ kind: 'docket', identifiers: { docketNumber: '1:26-cr-1' } });
    expect(doc.pages[0]!.text).toContain('#1 2026-01-02 Indictment');
    expect(doc.related).toEqual([expect.objectContaining({ kind: 'filing', url: 'https://www.courtlistener.com/docket/34/1/us-v-doe/', title: 'US v. Doe no. 1: Indictment' })]);
  });

  it('notes an empty docket', async () => {
    const { cl } = provider({ '/dockets/3/': {}, '/docket-entries/?docket=3&order_by=entry_number': { results: [] } });
    expect((await cl.read(new URL('https://www.courtlistener.com/docket/3/x/'))).note).toMatch(/No docket entries/);
  });

  it('reads a filing, preferring the main document over an attachment', async () => {
    const { cl } = provider({
      '/recap-documents/?docket_entry__docket=34&document_number=1': {
        results: [{ id: 100, attachment_number: 2, plain_text: 'attachment' }, { id: 99, attachment_number: null, plain_text: 'Count one.\fCount two.', page_count: 2, short_description: 'Indictment', date_filed: '2026-01-02' }],
      },
      '/dockets/34/': { case_name: 'US v. Doe', docket_number: '1:26-cr-1', court_id: 'dcd' },
    });
    const doc = await cl.read(new URL('https://www.courtlistener.com/docket/34/1/us-v-doe/'));
    expect(doc).toMatchObject({ kind: 'filing', title: 'US v. Doe no. 1: Indictment', issuer: 'dcd', identifiers: { docketNumber: '1:26-cr-1', filing: '1', pages: '2' } });
    expect(doc.pages).toHaveLength(2);
  });

  it('says why a filing has no text and 404s a missing one', async () => {
    const { cl } = provider({ '/recap-documents/?docket_entry__docket=1&document_number=2': { results: [{ id: 1, is_available: false }] }, '/recap-documents/?docket_entry__docket=1&document_number=3': { results: [{ id: 2, is_available: true }] }, '/recap-documents/?docket_entry__docket=1&document_number=4': { results: [] } });
    expect((await cl.read(new URL('https://www.courtlistener.com/docket/1/2/x/'))).note).toMatch(/not in RECAP/);
    expect((await cl.read(new URL('https://www.courtlistener.com/docket/1/3/x/'))).note).toMatch(/no extracted text/);
    await expect(cl.read(new URL('https://www.courtlistener.com/docket/1/4/x/'))).rejects.toThrow(/No filing 4/);
  });

  it('searches opinions, dockets and filings and maps them to refs', async () => {
    const { cl, calls } = provider({
      '/search/?q=doe&type=o': { results: [{ absolute_url: '/opinion/12/doe/', cluster_id: 12, caseName: 'Doe v. Roe', dateFiled: '2025-03-04', court: 'Supreme Court', opinions: [{ snippet: 'a <mark>doe</mark> &amp; b' }] }, { caseName: 'no url' }] },
      '/search/?q=doe&type=r': { results: [{ absolute_url: '/docket/34/us-v-doe/', docket_id: 34, caseName: 'US v. Doe', court_id: 'dcd' }] },
      '/search/?q=doe&type=rd': { results: [{ docket_absolute_url: 'https://www.courtlistener.com/docket/34/1/us-v-doe/', id: 7, case_name: 'US v. Doe', description: 'Indictment' }] },
    });
    const hits = await cl.search('doe', {});
    expect(hits.map((h) => [h.kind, h.url])).toEqual([['opinion', 'https://www.courtlistener.com/opinion/12/doe/'], ['docket', 'https://www.courtlistener.com/docket/34/us-v-doe/']]);
    expect(hits[0]).toMatchObject({ title: 'Doe v. Roe', issuer: 'Supreme Court', publishedOn: '2025-03-04', snippet: 'a doe & b' });
    const filings = await cl.search('doe', { kind: 'filing', limit: 99 });
    expect(filings[0]).toMatchObject({ kind: 'filing', snippet: 'Indictment' });
    expect(await cl.search('doe', { kind: 'bill' })).toEqual([]);
    expect(calls).toHaveLength(3);
  });

  it('turns upstream failures into clear errors and never calls without a token', async () => {
    const url = new URL('https://www.courtlistener.com/docket/1/x/');
    for (const [status, msg] of [[429, /rate limit/], [401, /rejected the API token/], [500, /returned 500/]] as const) {
      await expect(provider({ '/dockets/1/': {} }, 'tok', status).cl.read(url)).rejects.toThrow(msg);
    }
    await expect(provider({}).cl.read(url)).rejects.toThrow(/no such record/);
    const none = provider({}, '');
    expect(none.cl.configured()).toBe(false);
    await expect(none.cl.read(url)).rejects.toThrow(/not configured/);
    expect(none.calls).toEqual([]);
    await expect(none.cl.read(new URL('https://www.courtlistener.com/person/1/'))).rejects.toThrow(/not recognised/);
  });
});

function fake(over: Partial<DocumentProvider> = {}): DocumentProvider {
  return {
    id: 'fake', name: 'Fake', hosts: ['fake.gov'], kinds: ['rule'], configured: () => true, handles: (u) => u.pathname.startsWith('/doc'),
    search: vi.fn(async () => [{ provider: 'fake', id: '1', url: 'https://fake.gov/doc/1', title: 'Rule', kind: 'rule' as const }]),
    read: vi.fn(async (u: URL) => ({ provider: 'fake', id: '1', url: u.href, title: 'Rule', kind: 'rule' as const, identifiers: {}, pages: [{ page: 1, text: 'x' }], related: [] })),
    ...over,
  };
}

describe('DocumentProviders', () => {
  it('routes a url to the provider that owns its host, including subdomains', async () => {
    const f = fake();
    const reg = new DocumentProviders([f]);
    expect((await reg.read('https://www.fake.gov/doc/1')).provider).toBe('fake');
    expect(f.read).toHaveBeenCalledTimes(1);
  });

  it('refuses other hosts, bad urls, unconfigured providers and unrecognised links, without calling anything', async () => {
    const f = fake();
    const reg = new DocumentProviders([f, fake({ id: 'off', hosts: ['off.gov'], configured: () => false })]);
    await expect(reg.read('https://169.254.169.254/latest')).rejects.toThrow(/No document provider reads/);
    await expect(reg.read('https://fake.gov.evil.example/doc/1')).rejects.toThrow(/No document provider reads/);
    await expect(reg.read('not a url')).rejects.toThrow(/http/);
    await expect(reg.read('ftp://fake.gov/doc/1')).rejects.toThrow(/http/);
    await expect(reg.read('https://off.gov/doc/1')).rejects.toThrow(/not configured/);
    await expect(reg.read('https://fake.gov/other')).rejects.toThrow(/not recognised/);
    expect(f.read).not.toHaveBeenCalled();
  });

  it('searches every configured provider with the kind, collects errors, and honours a provider id', async () => {
    const good = fake();
    const bad = fake({ id: 'bad', kinds: ['rule'], search: vi.fn(async () => { throw new Error('down'); }) });
    const other = fake({ id: 'other', kinds: ['bill'] });
    const off = fake({ id: 'off', configured: () => false });
    const reg = new DocumentProviders([good, bad, other, off]);
    const all = await reg.search('q', { kind: 'rule' });
    expect(all.hits).toHaveLength(1);
    expect(all.errors).toEqual([{ provider: 'bad', error: 'down' }]);
    expect(other.search).not.toHaveBeenCalled();
    expect(off.search).not.toHaveBeenCalled();
    expect((await reg.search('q', { provider: 'fake' })).hits).toHaveLength(1);
    await expect(reg.search('q', { provider: 'nope' })).rejects.toThrow(/No document provider/);
    await expect(reg.search('q', { provider: 'off' })).rejects.toThrow(/not configured/);
    expect(reg.list().map((p) => [p.id, p.configured])).toEqual([['fake', true], ['bad', true], ['other', true], ['off', false]]);
    const weird = fake({ search: vi.fn(async () => { throw 'plain string'; }) });
    expect((await new DocumentProviders([weird]).search('q', {})).errors[0]!.error).toBe('plain string');
  });

  it('liveDocuments registers CourtListener, configured only when the key is set', () => {
    const before = process.env.COURT_LISTENER_API_KEY;
    delete process.env.COURT_LISTENER_API_KEY;
    expect(liveDocuments().list()).toMatchObject([{ id: 'courtlistener', configured: false }]);
    process.env.COURT_LISTENER_API_KEY = 'x';
    expect(liveDocuments().list()[0]!.configured).toBe(true);
    if (before === undefined) delete process.env.COURT_LISTENER_API_KEY;
    else process.env.COURT_LISTENER_API_KEY = before;
  });
});

describe('present', () => {
  const doc = {
    provider: 'x', id: '1', url: 'https://x/1', title: 'T', kind: 'filing', identifiers: {}, related: [],
    pages: [{ page: 1, text: 'a'.repeat(400) }, { page: 2, text: 'the key line is here' }, { page: 3, text: 'c'.repeat(400) }],
  } as unknown as SourceDocument;

  it('trims to the budget, says so, and checks the quote against the whole document', () => {
    const out = present(doc, { maxChars: 500, quote: 'KEY line' });
    expect(out.truncated).toBe(true);
    expect(out.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(out.pages.reduce((n, p) => n + p.text.length, 0)).toBe(500);
    expect(out.totalPages).toBe(3);
    expect(out.quote).toEqual({ text: 'KEY line', found: true, pages: [2] });
    expect(out.reference).toMatchObject({ label: 'T', url: 'https://x/1' });
    const stop = present(doc, { maxChars: 500 });
    expect(stop.pages.length).toBe(3);
    expect(present({ ...doc, pages: [{ page: 1, text: 'b'.repeat(600) }, { page: 2, text: 'z' }] } as SourceDocument, { maxChars: 500 }).pages).toHaveLength(1);
  });

  it('returns one page, everything when it fits, and a failed quote', () => {
    const one = present(doc, { page: 2, quote: 'nowhere' });
    expect(one.pages).toEqual([{ page: 2, text: 'the key line is here' }]);
    expect(one.truncated).toBe(false);
    expect(one.quote?.found).toBe(false);
    expect(present(doc).truncated).toBe(false);
    expect(present(doc).quote).toBeUndefined();
  });
});
