import * as http from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProbe, liveProbe } from './probe.js';

/** A real HTTP server on loopback, reached through a lookup that allows loopback: the guard is tested in net-safety.spec.ts. */
const loopback = ((_host: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) =>
  options.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)) as unknown as LookupFunction;

let server: http.Server;
let base: string;
const seen: { method?: string; ua?: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, ua: req.headers['user-agent'] });
    if (req.url === '/ok') res.writeHead(200).end('x'.repeat(10_000));
    else if (req.url === '/moved') res.writeHead(301, { location: '/ok' }).end();
    else if (req.url === '/slow') return; // never answers
    else res.writeHead(404).end('gone');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))));

describe('createProbe', () => {
  const probe = createProbe({ lookup: loopback, timeoutMs: 300 });

  it('reads the status line only, and identifies itself', async () => {
    seen.length = 0;
    expect(await probe(new URL(`${base}/ok`), 'HEAD')).toEqual({ status: 200 });
    expect(await probe(new URL(`${base}/missing`), 'GET')).toEqual({ status: 404 });
    expect(seen).toEqual([
      { method: 'HEAD', ua: expect.stringContaining('greed-linkcheck') },
      { method: 'GET', ua: expect.stringContaining('greed-linkcheck') },
    ]);
  });

  it('reports a redirect and its target without following it', async () => {
    expect(await probe(new URL(`${base}/moved`), 'HEAD')).toEqual({ status: 301, location: '/ok' });
  });

  it('gives up on a server that never answers, with a timeout code the checker understands', async () => {
    await expect(probe(new URL(`${base}/slow`), 'HEAD')).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  });

  it('rejects when nothing is listening', async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    await expect(probe(new URL(`http://localhost:${port}/`), 'HEAD')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('the default probe refuses a name that resolves to loopback, so it cannot be pointed at this machine', async () => {
    await expect(liveProbe(new URL(`${base}/ok`), 'HEAD')).rejects.toMatchObject({ code: expect.stringMatching(/EBLOCKED|ENOTFOUND/) });
  });
});
