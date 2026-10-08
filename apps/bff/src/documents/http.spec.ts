import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureOk, liveGet } from './http.js';

afterEach(() => vi.unstubAllGlobals());

describe('liveGet', () => {
  it('passes method, headers and body through with a timeout signal', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await liveGet('https://example.test/x', { headers: { A: '1' }, method: 'POST', body: '{"q":1}' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.test/x');
    expect(init).toMatchObject({ method: 'POST', body: '{"q":1}', headers: { A: '1' } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('ensureOk', () => {
  const res = (status: number) => ({ status, json: async () => ({}), text: async () => '' });
  it('passes 2xx and names the provider in every failure', () => {
    expect(ensureOk(res(200), 'X').status).toBe(200);
    expect(ensureOk(res(204), 'X').status).toBe(204);
    expect(() => ensureOk(res(404), 'X')).toThrow('X has no such record');
    expect(() => ensureOk(res(429), 'X')).toThrow(/X rate limit/);
    expect(() => ensureOk(res(401), 'X')).toThrow(/X rejected the request/);
    expect(() => ensureOk(res(403), 'X')).toThrow(/X rejected the request/);
    expect(() => ensureOk(res(302), 'X')).toThrow('X returned 302');
    expect(() => ensureOk(res(503), 'X')).toThrow('X returned 503');
  });
});
