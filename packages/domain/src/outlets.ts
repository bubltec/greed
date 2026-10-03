import { type Outlet, type TrustRating, statusOf } from './entities.js';

const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Host only: lowercase, no scheme, no path, no leading www. */
export function normalizeDomain(input: string): string {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/, 1)[0]!
    .replace(/\.$/, '');
  if (!DOMAIN.test(host)) throw new Error(`Not a domain: ${input.trim() || '(empty)'}`);
  return host;
}

const QUALITY: Record<TrustRating, number> = { high: 0, mixed: 1, low: 2 };
const BIAS: Record<TrustRating, number> = { low: 0, mixed: 1, high: 2 };

/**
 * Trust order. Paywalled outlets sort last (they are never searched). Then
 * higher accuracy, less bias, both sides, then more factual reporting.
 */
export function compareOutlets(a: Outlet, b: Outlet): number {
  const paywall = Number(a.paywall) - Number(b.paywall);
  if (paywall) return paywall;
  const accuracy = QUALITY[a.accuracy] - QUALITY[b.accuracy];
  if (accuracy) return accuracy;
  const bias = BIAS[a.bias] - BIAS[b.bias];
  if (bias) return bias;
  const oneSided = Number(a.oneSided) - Number(b.oneSided);
  if (oneSided) return oneSided;
  const factual = QUALITY[a.factual] - QUALITY[b.factual];
  if (factual) return factual;
  return a.name.localeCompare(b.name);
}

export function rankOutlets(outlets: readonly Outlet[]): Outlet[] {
  return [...outlets].sort(compareOutlets);
}

/** AgentCore domain filters accept at most 100 domains on each list. */
export const OUTLET_FILTER_CAP = 100;

export interface OutletSearchLists {
  /** Published outlets we may search, best first. */
  include: string[];
  /** Paywalled outlets, draft or published. Never searched. */
  exclude: string[];
  open: Outlet[];
  paywalled: Outlet[];
}

/**
 * What research is allowed to query. A paywall is a hard avoid even while the
 * outlet is still a draft. An open outlet is searched only once it is published.
 */
export function outletSearchLists(outlets: readonly Outlet[]): OutletSearchLists {
  const ranked = rankOutlets(outlets);
  const paywalled = ranked.filter((o) => o.paywall);
  const open = ranked.filter((o) => !o.paywall && statusOf(o) === 'published');
  return {
    include: open.slice(0, OUTLET_FILTER_CAP).map((o) => o.domain),
    exclude: paywalled.slice(0, OUTLET_FILTER_CAP).map((o) => o.domain),
    open: open.slice(0, OUTLET_FILTER_CAP),
    paywalled: paywalled.slice(0, OUTLET_FILTER_CAP),
  };
}

/** True when a result host is the domain or a subdomain of it. */
export function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return h === domain || h.endsWith(`.${domain}`);
}
