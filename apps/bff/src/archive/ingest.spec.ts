import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryContentStore } from '@greed/domain';
import { ContentService } from '../content/content.service.js';
import { InMemoryArchive, UnconfiguredArchive, archiveKey } from './archive.js';
import { type ExtractionOutcome, NoExtractor } from './extract.js';
import {
  ATTACHMENT_MIME_TYPES,
  BINARY_ATTACHMENT_MIME_TYPES,
  type BinaryGet,
  type BinaryResponse,
  MAX_ATTACHMENT_BYTES,
  archivableHosts,
  archiveFromUrl,
  extract,
  liveBinaryGet,
} from './ingest.js';

const HOSTS = ['courtlistener.com', 'justice.gov'];
const pdf = new TextEncoder().encode('%PDF-1.7 fake');
const ok = (bytes: Uint8Array = pdf, type = 'application/pdf'): BinaryResponse => ({ status: 200, headers: { 'content-type': type }, bytes });
const redirect = (location: string): BinaryResponse => ({ status: 302, headers: { location }, bytes: new Uint8Array(0) });

function setup(responses: BinaryResponse[]) {
  const archive = new InMemoryArchive();
  const calls: string[] = [];
  const get: BinaryGet = async (url) => {
    calls.push(url);
    return responses[Math.min(calls.length - 1, responses.length - 1)]!;
  };
  return { archive, calls, run: (url: string) => archiveFromUrl(url, { archive, get, hosts: HOSTS }) };
}

describe('archiveFromUrl', () => {
  it('fetches, hashes and stores a file under its content address', async () => {
    const { archive, calls, run } = setup([ok()]);
    const archived = await run('https://www.justice.gov/media/addendum.pdf');
    const sha = createHash('sha256').update(pdf).digest('hex');
    expect(archived).toMatchObject({ sha256: sha, mimeType: 'application/pdf', bytes: pdf.byteLength, sourceUrl: 'https://www.justice.gov/media/addendum.pdf', extractionStatus: 'pending' });
    expect(calls).toEqual(['https://www.justice.gov/media/addendum.pdf']);
    expect(archive.files.get(archiveKey(sha))).toMatchObject({ mimeType: 'application/pdf' });
    expect(archiveKey(sha)).toBe(`attachments/${sha}`);
  });

  it('reads plain text straight away, and leaves a scan or image waiting for OCR', async () => {
    const text = await setup([ok(new TextEncoder().encode('  The addendum reads: continue.  '), 'text/plain; charset=utf-8')]).run('https://justice.gov/t.txt');
    expect(text).toMatchObject({ mimeType: 'text/plain', extractedText: 'The addendum reads: continue.', extractionStatus: 'done' });
    expect(extract(new TextEncoder().encode('   '), 'text/plain')).toEqual({ extractionStatus: 'pending' });
    expect(extract(new Uint8Array([1, 2]), 'image/png')).toEqual({ extractionStatus: 'pending' });
    expect(extract(new TextEncoder().encode('x'.repeat(300_000)), 'text/plain').extractedText).toHaveLength(200_000);
  });

  it('follows redirects by hand and re-checks every hop against the allowlist', async () => {
    const followed = setup([redirect('/final.pdf'), ok()]);
    expect((await followed.run('https://justice.gov/start')).sourceUrl).toBe('https://justice.gov/final.pdf');
    expect(followed.calls).toEqual(['https://justice.gov/start', 'https://justice.gov/final.pdf']);

    const bounced = setup([redirect('https://evil.example/steal'), ok()]);
    await expect(bounced.run('https://justice.gov/start')).rejects.toThrow(/evil.example is not a trusted source/);
    expect(bounced.calls).toHaveLength(1); // the second hop was never requested

    const downgraded = setup([redirect('http://justice.gov/plain'), ok()]);
    await expect(downgraded.run('https://justice.gov/start')).rejects.toThrow(/https/);

    const loop = setup([redirect('https://justice.gov/again')]);
    await expect(loop.run('https://justice.gov/start')).rejects.toThrow(/Too many redirects/);
    expect(loop.calls).toHaveLength(4);
  });

  it('refuses anything that is not https, a trusted host, or a plain address, before fetching', async () => {
    const { calls, run } = setup([ok()]);
    await expect(run('not a url')).rejects.toThrow(/https URL/);
    await expect(run('http://justice.gov/a.pdf')).rejects.toThrow(/https URL/);
    await expect(run('ftp://justice.gov/a.pdf')).rejects.toThrow(/https URL/);
    await expect(run('https://user:pw@justice.gov/a.pdf')).rejects.toThrow(/credentials/);
    await expect(run('https://example.com/a.pdf')).rejects.toThrow(/example.com is not a trusted source.*courtlistener.com/);
    await expect(run('https://169.254.169.254/latest/meta-data')).rejects.toThrow(/not a trusted source/);
    await expect(run('https://notjustice.gov.evil.example/a.pdf')).rejects.toThrow(/not a trusted source/);
    await expect(run('https://evil-justice.gov/a.pdf')).rejects.toThrow(/not a trusted source/);
    expect(calls).toEqual([]);
  });

  it('refuses a file that is missing, broken, empty, too large, or of a type that cannot be archived', async () => {
    await expect(setup([{ status: 404, headers: {}, bytes: new Uint8Array(0) }]).run('https://justice.gov/a')).rejects.toThrow(/404/);
    await expect(setup([{ status: 503, headers: {}, bytes: new Uint8Array(0) }]).run('https://justice.gov/a')).rejects.toThrow(/returned 503/);
    await expect(setup([ok(new Uint8Array(0))]).run('https://justice.gov/a')).rejects.toThrow(/empty/);
    await expect(setup([ok(pdf, 'text/html')]).run('https://justice.gov/a')).rejects.toThrow(/text\/html cannot be archived/);
    await expect(setup([{ status: 200, headers: {}, bytes: pdf }]).run('https://justice.gov/a')).rejects.toThrow(/An unknown type cannot be archived/);
    await expect(setup([{ status: 200, headers: { 'content-type': 'application/pdf' }, bytes: new Uint8Array(0), tooLarge: true }]).run('https://justice.gov/a')).rejects.toThrow(/larger than 4 MB/);
    await expect(setup([ok(new Uint8Array(MAX_ATTACHMENT_BYTES + 1))]).run('https://justice.gov/a')).rejects.toThrow(/larger than 4 MB/);
  });

  it('says so when this stage has no archive, without fetching', async () => {
    const calls: string[] = [];
    const get: BinaryGet = async (url) => (calls.push(url), ok());
    await expect(archiveFromUrl('https://justice.gov/a.pdf', { archive: new UnconfiguredArchive(), get, hosts: HOSTS })).rejects.toThrow(/not configured/);
    expect(calls).toEqual([]);
    await expect(new UnconfiguredArchive().put()).rejects.toThrow(/not configured/);
    expect(await new UnconfiguredArchive().get()).toBeUndefined();
  });
});

describe('InMemoryArchive', () => {
  it('keeps its own copy of what it stores, so callers cannot change an archived file', async () => {
    const archive = new InMemoryArchive();
    const bytes = new Uint8Array([1, 2, 3]);
    await archive.put('k', { bytes, mimeType: 'image/png' });
    bytes[0] = 9;
    const read = (await archive.get('k'))!;
    expect([...read.bytes]).toEqual([1, 2, 3]);
    read.bytes[1] = 9;
    expect([...(await archive.get('k'))!.bytes]).toEqual([1, 2, 3]);
    expect(await archive.get('missing')).toBeUndefined();
  });
});

describe('archivableHosts', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const outlet = (domain: string, over: Record<string, unknown> = {}) => ({
    id: domain, name: domain, domain, paywall: false, accuracy: 'high', bias: 'low', oneSided: false, factual: 'high', status: 'published', createdAt: at, updatedAt: at, ...over,
  });

  it('is the document providers plus published, open outlets: never a draft or a paywalled one', async () => {
    const content = new ContentService(
      new InMemoryContentStore({
        outlets: [outlet('justice.gov'), outlet('draft.org', { status: 'draft' }), outlet('cnn.com', { paywall: true })] as never,
      }),
    );
    const hosts = await archivableHosts(content);
    expect(hosts).toEqual(expect.arrayContaining(['courtlistener.com', 'federalregister.gov', 'govinfo.gov', 'justice.gov']));
    expect(hosts).not.toContain('draft.org');
    expect(hosts).not.toContain('cnn.com');
  });
});

describe('archiveFromUrl with an extractor', () => {
  const reader = (outcome: ExtractionOutcome | Error) => ({
    configured: () => true,
    read: vi.fn(async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }),
  });
  const run = (extractor: ReturnType<typeof reader> | NoExtractor, response: BinaryResponse = ok()) =>
    archiveFromUrl('https://justice.gov/a', { archive: new InMemoryArchive(), get: async () => response, hosts: HOSTS, extractor });

  it('reads a scan through the extractor and carries the text and the caution back', async () => {
    const extractor = reader({ extractionStatus: 'done', extractedText: 'Continue.', note: 'check it' });
    expect(await run(extractor)).toMatchObject({ extractionStatus: 'done', extractedText: 'Continue.', extractionNote: 'check it' });
    expect(extractor.read).toHaveBeenCalledWith({ bytes: pdf, mimeType: 'application/pdf' });
  });

  it('still archives the file when extraction fails, and says it can be retried', async () => {
    const archive = new InMemoryArchive();
    const archived = await archiveFromUrl('https://justice.gov/a', { archive, get: async () => ok(), hosts: HOSTS, extractor: reader(new Error('throttled')) });
    expect(archived).toMatchObject({ extractionStatus: 'failed', extractionNote: 'Text extraction failed: throttled' });
    expect(archive.files.size).toBe(1);
  });

  it('does not run OCR on plain text, or when the stage has no extractor', async () => {
    const extractor = reader({ extractionStatus: 'done', extractedText: 'OCR' });
    const text = await run(extractor, ok(new TextEncoder().encode('Plain words.'), 'text/plain'));
    expect(text).toMatchObject({ extractedText: 'Plain words.' });
    expect(extractor.read).not.toHaveBeenCalled();
    expect(await run(new NoExtractor())).toMatchObject({ extractionStatus: 'pending' });
  });
});

describe('BINARY_ATTACHMENT_MIME_TYPES', () => {
  it('is every archivable type except text, so a served PDF or image is base64-encoded by the Lambda adapter', () => {
    expect(BINARY_ATTACHMENT_MIME_TYPES).toEqual(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    expect(BINARY_ATTACHMENT_MIME_TYPES).not.toContain('text/plain');
    expect(ATTACHMENT_MIME_TYPES.filter((t) => !BINARY_ATTACHMENT_MIME_TYPES.includes(t))).toEqual(['text/plain']);
  });

  it('caps a file so that, base64-encoded, it still fits in a 6 MB Lambda response', () => {
    expect(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3)).toBeLessThan(6 * 1024 * 1024);
  });
});

describe('liveBinaryGet', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (body: ConstructorParameters<typeof Response>[0], init: ResponseInit = {}) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, ...init })));

  it('reads a body without following redirects, and reports the headers it needs', async () => {
    stub(pdf, { headers: { 'content-type': 'application/pdf' } });
    const res = await liveBinaryGet('https://justice.gov/a.pdf', { maxBytes: 1000 });
    expect(res).toMatchObject({ status: 200, headers: { 'content-type': 'application/pdf' } });
    expect([...res.bytes]).toEqual([...pdf]);
    expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });

    stub(null, { status: 302, headers: { location: '/next' } });
    expect(await liveBinaryGet('https://justice.gov/a', { maxBytes: 1000 })).toMatchObject({ status: 302, headers: { location: '/next' }, bytes: new Uint8Array(0) });
  });

  it('stops reading a body that runs past the limit, whether or not it announced its size', async () => {
    stub('x'.repeat(50), { headers: { 'content-length': '5000' } });
    expect(await liveBinaryGet('https://justice.gov/a', { maxBytes: 10 })).toMatchObject({ tooLarge: true, bytes: new Uint8Array(0) });
    stub('x'.repeat(50));
    expect(await liveBinaryGet('https://justice.gov/a', { maxBytes: 10 })).toMatchObject({ tooLarge: true, bytes: new Uint8Array(0) });
  });
});
