import * as http from 'node:http';
import * as https from 'node:https';
import type * as net from 'node:net';
import { guardedLookup } from './net-safety.js';

export interface ProbeResponse {
  status: number;
  /** The `location` header, lowercased name, when the server sent one. */
  location?: string;
}

/** One request that reads the status line and headers only: the body is never read. */
export type Probe = (url: URL, method: 'HEAD' | 'GET') => Promise<ProbeResponse>;

export const LINK_PROBE = Symbol('LINK_PROBE');

export const PROBE_TIMEOUT_MS = 5_000;

/**
 * The live probe. Redirects are NOT followed here (the checker follows them by hand so it can
 * re-vet each hop), the connection's DNS lookup refuses non-public addresses, and the response is
 * destroyed as soon as the headers arrive.
 */
export function createProbe(options: { lookup?: net.LookupFunction; timeoutMs?: number } = {}): Probe {
  const lookup = options.lookup ?? guardedLookup();
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  return (url, method) =>
    new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? https : http).request(
        url,
        {
          method,
          lookup,
          agent: false,
          timeout: timeoutMs,
          headers: { 'user-agent': 'greed-linkcheck/1.0 (+https://greed.bubbletech.io)', accept: '*/*' },
        },
        (res) => {
          const location = res.headers.location;
          resolve({ status: res.statusCode ?? 0, ...(location ? { location } : {}) });
          res.destroy();
        },
      );
      request.on('timeout', () => request.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
      request.on('error', reject);
      request.end();
    });
}

export const liveProbe: Probe = createProbe();
