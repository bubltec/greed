import { describe, expect, it, vi } from 'vitest';
import type { Outlet } from '@greed/domain';
import { MAX_REDIRECTS, checkLink, checkLinks, refusal } from './check.js';
import type { Probe, ProbeResponse } from './probe.js';

/** A probe that answers from a table keyed by `METHOD url`, falling back to the URL alone. */
function fake(table: Record<string, ProbeResponse | Error>) {
  const calls: string[] = [];
  const probe: Probe = async (url, method) => {
    calls.push(`${method} ${url.href}`);
    const answer = table[`${method} ${url.href}`] ?? table[url.href];
    if (!answer) throw new Error(`unexpected ${method} ${url.href}`);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { probe, calls };
}
const coded = (code: string) => Object.assign(new Error(code), { code });
const paywalled = [{ name: 'The Times', domain: 'nytimes.com', paywall: true }] as unknown as Outlet[];

describe('checkLink classification', () => {
  const run = (answer: ProbeResponse | Error, url = 'https://example.com/a') => checkLink(url, fake({ [url]: answer }).probe);

  it('leaves a healthy link without a code', async () => {
    expect(await run({ status: 200 })).toEqual({ url: 'https://example.com/a', detail: '200' });
    expect((await run({ status: 204 })).code).toBeUndefined();
  });

  it('calls 404 and 410 broken with high confidence, other client errors broken with medium', async () => {
    for (const status of [404, 410]) expect(await run({ status })).toMatchObject({ code: 'LINK_BROKEN', confidence: 'high', detail: String(status) });
    expect(await run({ status: 400 })).toMatchObject({ code: 'LINK_BROKEN', confidence: 'medium' });
  });

  it('does not call a refusal "broken": 401, 403, 429, 451 and 999 are blocked, for a person to open', async () => {
    for (const status of [401, 403, 429, 451, 999]) {
      const result = await checkLink('https://example.com/a', fake({ 'HEAD https://example.com/a': { status }, 'GET https://example.com/a': { status } }).probe);
      expect(result, String(status)).toMatchObject({ code: 'LINK_BLOCKED', confidence: 'low' });
    }
  });

  it('reports server errors as errors worth retrying', async () => {
    expect(await run({ status: 503 })).toMatchObject({ code: 'LINK_ERROR', detail: expect.stringContaining('503') });
  });

  it('turns network failures into findings: no such domain, timeout, anything else', async () => {
    expect(await run(coded('ENOTFOUND'))).toMatchObject({ code: 'LINK_BROKEN', confidence: 'high', detail: 'domain does not resolve' });
    expect(await run(coded('EAI_AGAIN'))).toMatchObject({ code: 'LINK_BROKEN' });
    expect(await run(coded('ETIMEDOUT'))).toMatchObject({ code: 'LINK_ERROR', detail: 'timed out' });
    expect(await run(coded('ECONNRESET'))).toMatchObject({ code: 'LINK_ERROR', detail: 'ECONNRESET' });
    expect(await run(new Error('socket hang up'))).toMatchObject({ code: 'LINK_ERROR', detail: 'socket hang up' });
    expect(await run(coded('EBLOCKED'))).toMatchObject({ code: 'LINK_UNCHECKED', detail: expect.stringContaining('non-public') });
    const throwsString: Probe = async () => Promise.reject('boom');
    expect(await checkLink('https://example.com/a', throwsString)).toMatchObject({ code: 'LINK_ERROR', detail: 'request failed' });
  });

  it('retries a server that refuses HEAD with one GET', async () => {
    const { probe, calls } = fake({ 'HEAD https://example.com/a': { status: 405 }, 'GET https://example.com/a': { status: 200 } });
    expect((await checkLink('https://example.com/a', probe)).code).toBeUndefined();
    expect(calls).toEqual(['HEAD https://example.com/a', 'GET https://example.com/a']);
    const { probe: ok, calls: once } = fake({ 'HEAD https://example.com/a': { status: 200 } });
    await checkLink('https://example.com/a', ok);
    expect(once).toEqual(['HEAD https://example.com/a']);
  });
});

describe('checkLink redirects', () => {
  it('reports a permanent redirect to another page as moved with high confidence, and gives the new address', async () => {
    const { probe } = fake({ 'https://a.com/old': { status: 301, location: '/new' }, 'https://a.com/new': { status: 200 } });
    expect(await checkLink('https://a.com/old', probe)).toMatchObject({ code: 'LINK_MOVED', confidence: 'high', finalUrl: 'https://a.com/new' });
    const { probe: p308 } = fake({ 'https://a.com/old': { status: 308, location: 'https://b.com/x' }, 'https://b.com/x': { status: 200 } });
    expect(await checkLink('https://a.com/old', p308)).toMatchObject({ confidence: 'high', finalUrl: 'https://b.com/x' });
  });

  it('is less sure about a temporary redirect', async () => {
    const { probe } = fake({ 'https://a.com/old': { status: 302, location: '/new' }, 'https://a.com/new': { status: 200 } });
    expect(await checkLink('https://a.com/old', probe)).toMatchObject({ code: 'LINK_MOVED', confidence: 'medium', detail: 'temporary redirect' });
  });

  it('treats http to https, adding www and a trailing slash as housekeeping, low confidence', async () => {
    for (const [from, to] of [['http://a.com/p', 'https://a.com/p'], ['https://a.com/p', 'https://www.a.com/p'], ['https://a.com/p', 'https://a.com/p/']] as const) {
      const { probe } = fake({ [from]: { status: 301, location: to }, [to]: { status: 200 } });
      expect(await checkLink(from, probe), from).toMatchObject({ code: 'LINK_MOVED', confidence: 'low', finalUrl: to });
    }
  });

  it('reports a redirect that ends in 404 as broken', async () => {
    const { probe } = fake({ 'https://a.com/old': { status: 301, location: '/gone' }, 'https://a.com/gone': { status: 404 } });
    expect(await checkLink('https://a.com/old', probe)).toMatchObject({ code: 'LINK_BROKEN', detail: '404' });
  });

  it(`stops after ${MAX_REDIRECTS} redirects`, async () => {
    const { probe, calls } = fake({ 'https://a.com/0': { status: 302, location: '/1' }, 'https://a.com/1': { status: 302, location: '/2' }, 'https://a.com/2': { status: 302, location: '/3' }, 'https://a.com/3': { status: 302, location: '/4' } });
    expect(await checkLink('https://a.com/0', probe)).toMatchObject({ code: 'LINK_ERROR', detail: `more than ${MAX_REDIRECTS} redirects` });
    expect(calls).toHaveLength(MAX_REDIRECTS + 1);
  });

  it('vets every hop: a redirect to loopback, a private IP, a metadata address, another scheme or port is never requested', async () => {
    for (const target of ['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://10.0.0.5/', 'ftp://a.com/f', 'https://a.com:8443/x', 'https://user:pw@a.com/']) {
      const { probe, calls } = fake({ 'https://a.com/start': { status: 302, location: target } });
      expect(await checkLink('https://a.com/start', probe), target).toMatchObject({ code: 'LINK_UNCHECKED' });
      expect(calls, target).toEqual(['HEAD https://a.com/start']);
    }
  });
});

describe('checkLink refusals', () => {
  it('does not request a URL on a private address, an odd port, another scheme or with credentials', async () => {
    const probe = vi.fn();
    for (const url of ['http://127.0.0.1/', 'http://localhost:9001/2018-06-01/runtime/invocation/next', 'https://a.com:8080/', 'file:///etc/passwd', 'ftp://a.com/', 'https://u:p@a.com/', 'http://[fd00::1]/', 'http://2130706433/']) {
      const result = await checkLink(url, probe);
      expect(result.code, url).toBe('LINK_UNCHECKED');
    }
    expect(probe).not.toHaveBeenCalled();
  });

  it('says why', () => {
    expect(refusal(new URL('http://127.0.0.1/'))).toMatch(/non-public/);
    expect(refusal(new URL('https://a.com:8080/'))).toMatch(/port 8080/);
    expect(refusal(new URL('ftp://a.com/'))).toMatch(/not checked/);
    expect(refusal(new URL('https://u:p@a.com/'))).toMatch(/credentials/);
    expect(refusal(new URL('https://a.com:443/'))).toBeUndefined();
    expect(refusal(new URL('http://a.com/'))).toBeUndefined();
  });

  it('calls an unparseable URL broken without any request', async () => {
    const probe = vi.fn();
    expect(await checkLink('not a url', probe)).toMatchObject({ code: 'LINK_BROKEN', detail: 'not a valid URL' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('flags a cited paywalled outlet without fetching it, subdomains included', async () => {
    const probe = vi.fn();
    expect(await checkLink('https://www.nytimes.com/2026/story', probe, paywalled)).toMatchObject({ code: 'LINK_PAYWALLED', confidence: 'medium' });
    expect(probe).not.toHaveBeenCalled();
    expect((await checkLink('https://example.com/a', fake({ 'https://example.com/a': { status: 200 } }).probe, paywalled)).code).toBeUndefined();
  });
});

describe('checkLinks', () => {
  const ok: Probe = async () => ({ status: 200 });

  it('checks every link in order, a few at a time', async () => {
    let running = 0;
    let peak = 0;
    const probe: Probe = async () => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return { status: 200 };
    };
    const urls = Array.from({ length: 12 }, (_, i) => `https://a.com/${i}`);
    const results = await checkLinks(urls, probe, { concurrency: 3 });
    expect(results.map((r) => r.url)).toEqual(urls);
    expect(peak).toBe(3);
  });

  it('stops starting links once the budget is spent, so the caller can resume after the ones it did', async () => {
    let clock = 0;
    const probe: Probe = async () => ((clock += 10), { status: 200 });
    const urls = Array.from({ length: 10 }, (_, i) => `https://a.com/${i}`);
    const results = await checkLinks(urls, probe, { concurrency: 1, budgetMs: 35, now: () => clock });
    expect(results.map((r) => r.url)).toEqual(urls.slice(0, 4));
  });

  it('handles an empty list and passes outlets through', async () => {
    expect(await checkLinks([], ok)).toEqual([]);
    expect((await checkLinks(['https://nytimes.com/x'], ok, { outlets: paywalled }))[0]).toMatchObject({ code: 'LINK_PAYWALLED' });
  });
});
