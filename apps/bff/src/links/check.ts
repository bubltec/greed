import { hostMatches, type Outlet } from '@greed/domain';
import { ipLiteral, isPublicAddress } from './net-safety.js';
import type { Probe } from './probe.js';

export const LINK_CODES = ['LINK_BROKEN', 'LINK_MOVED', 'LINK_BLOCKED', 'LINK_ERROR', 'LINK_UNCHECKED', 'LINK_PAYWALLED'] as const;
export type LinkCode = (typeof LINK_CODES)[number];

export interface LinkResult {
  url: string;
  /** Absent when the link is fine. */
  code?: LinkCode;
  confidence?: 'high' | 'medium' | 'low';
  detail: string;
  /** Where a moved link now lives. */
  finalUrl?: string;
}

export const MAX_REDIRECTS = 3;
/** Ports a checked link may use: a citation on any other port is not something to dial from here. */
const PORTS = new Set(['', '80', '443']);
/** Servers that refuse HEAD but answer GET, so one GET retry is worth it. */
const RETRY_WITH_GET = new Set([400, 403, 405, 501]);
/** The server is saying "not you", not "not found": a person should look. */
const BLOCKED_STATUS = new Set([401, 403, 429, 451, 999]);

/** Why a URL may not be requested at all, or undefined when it may. */
export function refusal(url: URL): string | undefined {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return `${url.protocol.replace(':', '')} links are not checked`;
  if (url.username || url.password) return 'link carries credentials';
  if (!PORTS.has(url.port)) return `port ${url.port} is not checked`;
  const literal = ipLiteral(url);
  if (literal && !isPublicAddress(literal)) return 'link points at a non-public address';
  return undefined;
}

/** Same page apart from scheme, `www.`, fragment, trailing slash or case of the host. */
const sameSpot = (a: URL, b: URL) =>
  a.hostname.toLowerCase().replace(/^www\./, '') === b.hostname.toLowerCase().replace(/^www\./, '') &&
  a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, '') &&
  a.search === b.search;

async function request(probe: Probe, url: URL) {
  const head = await probe(url, 'HEAD');
  return RETRY_WITH_GET.has(head.status) ? probe(url, 'GET') : head;
}

/** Checks one link: follows up to three redirects by hand, vetting every hop, and classifies the outcome. */
export async function checkLink(rawUrl: string, probe: Probe, outlets: readonly Outlet[] = []): Promise<LinkResult> {
  let start: URL;
  try {
    start = new URL(rawUrl);
  } catch {
    return { url: rawUrl, code: 'LINK_BROKEN', confidence: 'high', detail: 'not a valid URL' };
  }
  const blocked = refusal(start);
  if (blocked) return { url: rawUrl, code: 'LINK_UNCHECKED', confidence: 'low', detail: blocked };
  const paywalled = outlets.find((o) => o.paywall && hostMatches(start.hostname, o.domain));
  if (paywalled) return { url: rawUrl, code: 'LINK_PAYWALLED', confidence: 'medium', detail: `${paywalled.name} is paywalled; not fetched` };

  let current = start;
  let permanent = false;
  try {
    for (let hop = 0; ; hop++) {
      const res = await request(probe, current);
      if (res.status >= 300 && res.status < 400 && res.location) {
        if (hop === MAX_REDIRECTS) return { url: rawUrl, code: 'LINK_ERROR', confidence: 'medium', detail: `more than ${MAX_REDIRECTS} redirects` };
        if (hop === 0) permanent = res.status === 301 || res.status === 308;
        const next = new URL(res.location, current);
        const why = refusal(next);
        if (why) return { url: rawUrl, code: 'LINK_UNCHECKED', confidence: 'low', detail: `redirects to ${next.host}: ${why}` };
        current = next;
        continue;
      }
      return classify(rawUrl, start, current, res.status, permanent);
    }
  } catch (error) {
    return failure(rawUrl, error);
  }
}

function classify(rawUrl: string, start: URL, final: URL, status: number, permanent: boolean): LinkResult {
  if (status >= 200 && status < 300) {
    if (final.href === start.href || sameSpot(start, final)) {
      // http to https, or adding www., is housekeeping, not a moved page.
      return final.protocol !== start.protocol || final.href !== start.href
        ? { url: rawUrl, code: 'LINK_MOVED', confidence: 'low', detail: `${status} after redirect (scheme or host form)`, finalUrl: final.href }
        : { url: rawUrl, detail: `${status}` };
    }
    return {
      url: rawUrl,
      code: 'LINK_MOVED',
      confidence: permanent ? 'high' : 'medium',
      detail: `${permanent ? 'permanent' : 'temporary'} redirect`,
      finalUrl: final.href,
    };
  }
  if (BLOCKED_STATUS.has(status)) return { url: rawUrl, code: 'LINK_BLOCKED', confidence: 'low', detail: `${status}: the site refuses automated checks; open it by hand` };
  if (status === 404 || status === 410) return { url: rawUrl, code: 'LINK_BROKEN', confidence: 'high', detail: `${status}` };
  if (status >= 500) return { url: rawUrl, code: 'LINK_ERROR', confidence: 'medium', detail: `${status} server error; try again later` };
  return { url: rawUrl, code: 'LINK_BROKEN', confidence: 'medium', detail: `${status}` };
}

function failure(rawUrl: string, error: unknown): LinkResult {
  const code = (error as { code?: string }).code;
  if (code === 'EBLOCKED') return { url: rawUrl, code: 'LINK_UNCHECKED', confidence: 'low', detail: 'host resolves to a non-public address' };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { url: rawUrl, code: 'LINK_BROKEN', confidence: 'high', detail: 'domain does not resolve' };
  if (code === 'ETIMEDOUT') return { url: rawUrl, code: 'LINK_ERROR', confidence: 'medium', detail: 'timed out' };
  return { url: rawUrl, code: 'LINK_ERROR', confidence: 'medium', detail: `${code ?? (error instanceof Error ? error.message : 'request failed')}` };
}

/**
 * Checks links a few at a time, in order, until the time budget is spent. Returns the results for
 * the links it started, so the caller resumes after them. Duplicates are the caller's to remove.
 */
export async function checkLinks(
  urls: readonly string[],
  probe: Probe,
  options: { outlets?: readonly Outlet[]; concurrency?: number; budgetMs?: number; now?: () => number } = {},
): Promise<LinkResult[]> {
  const { outlets = [], concurrency = 5, budgetMs = 20_000, now = Date.now } = options;
  const deadline = now() + budgetMs;
  const results: LinkResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < urls.length && now() < deadline) {
      const i = next++;
      results[i] = await checkLink(urls[i]!, probe, outlets);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return results.filter((r) => r !== undefined);
}
