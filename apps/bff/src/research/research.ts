import { createHash } from 'node:crypto';
import { hostMatches, outletSearchLists, type Outlet, type Reference, type Topic } from '@greed/domain';
import type { ContentService } from '../content/content.service.js';
import { AgentCoreResearchMemory } from './memory.js';
import { GatewaySearchClient } from './gateway.js';
import type { ResearchMemory, SearchClient, SearchHit } from './types.js';

const MAX_PER_QUERY = 5;
const MAX_HITS = 12;

export interface ResearchDeps {
  search?: SearchClient;
  memory?: ResearchMemory;
}

export interface ResearchOptions {
  /** Replaces the three generated queries, for a narrow follow-up such as one meeting or one filing. */
  query?: string;
  /** Keep hits published on or after this date (YYYY-MM-DD). Undated hits are kept and marked. */
  from?: string;
  /** Keep hits published on or before this date (YYYY-MM-DD). */
  to?: string;
}

export interface ResearchHit extends SearchHit {
  outlet?: string;
  /** A date range was asked for but the hit carries no publication date, so it could not be checked. */
  undated?: boolean;
  /** This query's result was read from short-term memory, not searched again. */
  fromMemory?: boolean;
}

export interface ResearchReport {
  configured: boolean;
  topicId: string;
  title?: string;
  /** Published open outlets, best first. Empty means nothing was searched. */
  searched: { name: string; domain: string }[];
  /** Paywalled outlets that were not queried. */
  skippedPaywalls: { name: string; domain: string }[];
  queries: { query: string; fromMemory: boolean; error?: string }[];
  hits: ResearchHit[];
  message?: string;
}

export function liveResearch(): ResearchDeps {
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const gatewayUrl = process.env.AGENTCORE_GATEWAY_URL;
  const memoryId = process.env.AGENTCORE_MEMORY_ID;
  return {
    search: gatewayUrl ? new GatewaySearchClient({ gatewayUrl, region }) : undefined,
    memory: memoryId ? new AgentCoreResearchMemory({ memoryId, region }) : undefined,
  };
}

/** Stable session for every dive on this topic. Long enough for AgentCore. */
export function researchSessionId(topicId: string): string {
  return `greed-research-${createHash('sha256').update(topicId).digest('hex')}`;
}

/** Changes when the query or the outlet lists change, so a new rating is not served a stale result. */
export function researchKey(query: string, include: readonly string[], exclude: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify({ query, include: [...include].sort(), exclude: [...exclude].sort() }))
    .digest('hex')
    .slice(0, 40);
}

/** Three angles: the claim, the denial, and a primary document. Each stays within the 200-character search limit. */
export function researchQueries(topic: Pick<Topic, 'title' | 'summary' | 'disputed'>): string[] {
  const title = topic.title.trim();
  const claim = squash(`${title}. ${topic.summary}`);
  const denial = squash(topic.disputed.trim() ? `${title} ${topic.disputed}` : `${title} denial response criticism`);
  const primary = squash(`${title} filing indictment court document official report`);
  return [claim, denial, primary];
}

/**
 * Dive that does not write a reference. Reuses a stored search when this topic
 * was already queried with the same outlet list. Memory is best-effort: a
 * failed read or write still searches and still returns the hits.
 */
export async function researchTopic(
  content: ContentService,
  topicId: string,
  deps: ResearchDeps,
  options: ResearchOptions = {},
): Promise<ResearchReport> {
  const topic = (await content.find('topic', topicId)) as Topic;
  const index = await content.index(true);
  const lists = outletSearchLists(index.snapshot.outlets ?? []);
  const base = {
    topicId,
    title: topic.title,
    searched: lists.open.map(brief),
    skippedPaywalls: lists.paywalled.map(brief),
    queries: [] as ResearchReport['queries'],
    hits: [] as ResearchHit[],
  };
  if (!deps.search) {
    return { ...base, configured: false, message: 'Web search is not configured for this stage.' };
  }
  if (lists.include.length === 0) {
    return {
      ...base,
      configured: true,
      message: 'No published outlets to search. Paywalled outlets are skipped; publish an open outlet first.',
    };
  }

  const cited = new Set(
    index.snapshot.references.filter((r) => r.topicId === topicId && r.url).map((r) => r.url!),
  );
  const seen = new Set<string>();
  const hits: ResearchHit[] = [];
  const sessionId = researchSessionId(topicId);
  const filter = { include: lists.include, exclude: lists.exclude };
  const search = deps.search;

  async function runQuery(query: string): Promise<{ query: string; fromMemory: boolean; error?: string; results: SearchHit[] }> {
    const key = researchKey(query, lists.include, lists.exclude);
    if (deps.memory) {
      try {
        const stored = await deps.memory.recall(sessionId, key);
        if (stored) return { query, fromMemory: true, results: stored };
      } catch {
        // A broken memory must not skip the search.
      }
    }
    try {
      const results = await search.search(query, MAX_PER_QUERY, filter);
      if (deps.memory) {
        try {
          await deps.memory.remember(sessionId, key, results);
        } catch {
          // The live hits still go back. The next dive searches again.
        }
      }
      return { query, fromMemory: false, results };
    } catch (err) {
      return { query, fromMemory: false, results: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  const custom = options.query?.trim();
  const angles = custom ? [squash(custom)] : researchQueries(topic);
  const settled = await Promise.all(angles.map((query) => runQuery(query)));
  const queries: ResearchReport['queries'] = [];
  for (const row of settled) {
    queries.push({ query: row.query, fromMemory: row.fromMemory, ...(row.error ? { error: row.error } : {}) });
    for (const result of row.results) {
      for (const hit of keep(result, lists, cited, seen)) {
        const inRange = withinDates(hit.publishedDate, options);
        if (inRange === false) continue;
        hits.push({
          ...hit,
          outlet: outletName(hit.url, lists.open),
          fromMemory: row.fromMemory,
          ...(inRange === undefined ? { undated: true } : {}),
        });
        if (hits.length >= MAX_HITS) {
          return { ...base, configured: true, queries, hits };
        }
      }
    }
  }
  return { ...base, configured: true, queries, hits };
}

function keep(hit: SearchHit, lists: ReturnType<typeof outletSearchLists>, cited: Set<string>, seen: Set<string>): SearchHit[] {
  if (!hit.url || cited.has(hit.url) || seen.has(hit.url)) return [];
  let host = '';
  try {
    host = new URL(hit.url).hostname;
  } catch {
    return [];
  }
  if (lists.exclude.some((domain) => hostMatches(host, domain))) return [];
  if (!lists.include.some((domain) => hostMatches(host, domain))) return [];
  seen.add(hit.url);
  return [hit];
}

/** true/false when the hit's date can be compared with the range, undefined when a range was asked for and the date is missing or unreadable. */
function withinDates(published: string | undefined, { from, to }: ResearchOptions): boolean | undefined {
  if (!from && !to) return true;
  const day = published?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!day) return undefined;
  return (!from || day >= from) && (!to || day <= to);
}

function outletName(url: string, open: Outlet[]): string | undefined {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  return open.find((o) => hostMatches(host, o.domain))?.name;
}

function brief(o: Outlet): { name: string; domain: string } {
  return { name: o.name, domain: o.domain };
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
}

export interface UrlSuggestions {
  configured: boolean;
  referenceId: string;
  label: string;
  candidates: ResearchHit[];
  message?: string;
}

/**
 * Candidate URLs for a reference saved without one. Searches the same open,
 * published outlets as a dive, using the reference's label, excerpt and date
 * alongside the topic title. Writes nothing: the editor picks one and calls
 * update_reference.
 */
export async function suggestReferenceUrls(
  content: ContentService,
  referenceId: string,
  deps: ResearchDeps,
): Promise<UrlSuggestions> {
  const ref = (await content.find('reference', referenceId)) as Reference;
  const topic = (await content.find('topic', ref.topicId)) as Topic;
  const base = { referenceId, label: ref.label, candidates: [] as ResearchHit[] };
  if (ref.url) return { ...base, configured: true, message: 'This reference already has a URL.' };
  if (!deps.search) return { ...base, configured: false, message: 'Web search is not configured for this stage.' };
  const lists = outletSearchLists((await content.index(true)).snapshot.outlets ?? []);
  if (lists.include.length === 0) {
    return { ...base, configured: true, message: 'No published outlets to search. Publish an open outlet first.' };
  }
  const query = squash([ref.label, ref.excerpt, topic.title, ref.publishedOn].filter(Boolean).join(' '));
  const found = await deps.search.search(query, MAX_PER_QUERY, { include: lists.include, exclude: lists.exclude });
  const seen = new Set<string>();
  const candidates = found
    .flatMap((hit) => keep(hit, lists, new Set(), seen))
    .map((hit) => ({ ...hit, outlet: outletName(hit.url, lists.open) }));
  return { ...base, configured: true, candidates };
}
