import { hostMatches, outletSearchLists, type Outlet, type Reference, type Topic } from '@greed/domain';
import type { ContentService } from '../content/content.service.js';
import type { ResearchDeps, ResearchHit } from './research.js';
import type { SearchHit } from './types.js';

const PASSAGE_CHARS = 4000;
const RELATED_MAX = 5;

export interface SourceDetails {
  configured: boolean;
  url: string;
  /** The page came back from Web Search. False means it is not indexed there; nothing was read. */
  found: boolean;
  title?: string;
  publishedDate?: string;
  /** The passage Web Search returned for this page (up to 4000 characters), untrusted page text. */
  text?: string;
  /** The catalog entry for the page's host, so the caller can weigh it. */
  outlet?: { name: string; domain: string; accuracy: Outlet['accuracy']; bias: Outlet['bias']; oneSided: boolean; factual: Outlet['factual'] };
  /** Topics that already cite this URL. */
  citedOn: { topicId: string; title: string; referenceId: string }[];
  /** Other pages on the open outlets about the same story, to follow up. Already-cited and the page itself are left out. */
  related: ResearchHit[];
  message?: string;
}

/**
 * Reads one page through AgentCore Web Search, not by fetching it: the search is
 * restricted to the page's own host, so no request leaves the BFF for an
 * arbitrary URL. Only published, non-paywalled outlets are allowed. Writes nothing.
 */
export async function fetchSource(content: ContentService, rawUrl: string, question: string | undefined, deps: ResearchDeps): Promise<SourceDetails> {
  const base: SourceDetails = { configured: true, url: rawUrl, found: false, citedOn: [], related: [] };
  const url = parseHttpUrl(rawUrl);
  if (!url) return { ...base, message: 'url must be an http(s) URL.' };
  const index = await content.index(true);
  const outlets = index.snapshot.outlets ?? [];
  const host = url.hostname;
  const outlet = outlets.find((o) => hostMatches(host, o.domain));
  if (outlet?.paywall) {
    return { ...base, outlet: brief(outlet), message: `${outlet.name} is paywalled, a hard avoid. Look for a licensed syndicated copy instead.` };
  }
  const lists = outletSearchLists(outlets);
  const open = lists.open.find((o) => hostMatches(host, o.domain));
  if (!open) {
    return { ...base, message: 'That host is not a published, open outlet. Add it with create_outlet and publish it first.' };
  }
  if (!deps.search) return { ...base, configured: false, outlet: brief(open), message: 'Web search is not configured for this stage.' };

  const key = normalize(url);
  const cites = index.snapshot.references.filter((r) => r.url && normalizeText(r.url) === key);
  const titles = new Map(index.snapshot.topics.map((t: Topic) => [t.id, t.title]));
  const citedOn = cites.map((r: Reference) => ({ topicId: r.topicId, title: titles.get(r.topicId) ?? r.topicId, referenceId: r.id }));

  const query = (question?.trim() ? `${question.trim()} ${url.href}` : url.href).slice(0, 200);
  const results = await deps.search.search(query, 10, { include: [open.domain], exclude: [] }, { maxText: PASSAGE_CHARS });
  const page = results.find((hit) => normalizeText(hit.url) === key);
  if (!page) {
    return {
      ...base,
      outlet: brief(open),
      citedOn,
      message: 'Web Search has no copy of that exact page. Open it yourself, or search for the title with research_topic.',
    };
  }

  let related: ResearchHit[] = [];
  if (page.title) {
    const cited = new Set(index.snapshot.references.flatMap((r) => normalizeText(r.url ?? '') ?? []));
    const more = await deps.search.search(page.title.slice(0, 200), RELATED_MAX + 3, { include: lists.include, exclude: lists.exclude });
    related = more.flatMap((hit) => relatedHit(hit, key, cited, lists.open)).slice(0, RELATED_MAX);
  }
  return {
    ...base,
    found: true,
    title: page.title,
    publishedDate: page.publishedDate,
    text: page.text,
    outlet: brief(open),
    citedOn,
    related,
  };
}

function relatedHit(hit: SearchHit, pageKey: string, cited: Set<string>, open: Outlet[]): ResearchHit[] {
  const target = parseHttpUrl(hit.url);
  if (!target) return [];
  const k = normalize(target);
  if (k === pageKey || cited.has(k)) return [];
  const outlet = open.find((o) => hostMatches(target.hostname, o.domain));
  return outlet ? [{ ...hit, outlet: outlet.name }] : [];
}

function brief(o: Outlet): NonNullable<SourceDetails['outlet']> {
  return { name: o.name, domain: o.domain, accuracy: o.accuracy, bias: o.bias, oneSided: o.oneSided, factual: o.factual };
}

function parseHttpUrl(raw: string): URL | undefined {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : undefined;
  } catch {
    return undefined;
  }
}

/** Same page regardless of scheme, www, fragment, query string or trailing slash. */
function normalize(u: URL): string {
  return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
}

function normalizeText(raw: string): string | undefined {
  const u = parseHttpUrl(raw);
  return u ? normalize(u) : undefined;
}
