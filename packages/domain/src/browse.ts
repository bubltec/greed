import type { TopicKind } from './entities.js';
import { TOPIC_KINDS } from './entities.js';
import type { ActivityEntry, TopicSummary } from './views.js';

export const TOPIC_SORTS = ['title', 'updated', 'created', 'links', 'sources', 'perspectives', 'kind'] as const;
export type TopicSort = (typeof TOPIC_SORTS)[number];
export type SortDir = 'asc' | 'desc';

export const ACTIVITY_TYPES = ['topic', 'reference', 'perspective', 'relation'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_SIZE = 25;
const MAX_SIZE = 100;

/** Sorts where a bigger number is the interesting end, so the first click shows it. */
const DESC_FIRST: ReadonlySet<TopicSort> = new Set(['updated', 'created', 'links', 'sources', 'perspectives']);

export interface ResultPage<T> {
  items: T[];
  total: number;
  /** The page actually returned (a request past the end gets the last page). */
  page: number;
  size: number;
  pages: number;
}

export interface BrowseQuery {
  q: string;
  kind?: TopicKind;
  sort: TopicSort;
  dir: SortDir;
  page: number;
  size: number;
}

export interface TopicBrowse extends ResultPage<TopicSummary> {
  /** Entries in the whole record, before any search or filter. */
  all: number;
  /** Matches of the search, per kind, ignoring the kind filter, so the chips show what each would give. */
  kinds: Partial<Record<TopicKind, number>>;
}

export interface ActivityQuery {
  type?: ActivityType;
  dir: SortDir;
  page: number;
  size: number;
}

export interface ActivityBrowse extends ResultPage<ActivityEntry> {
  /** Entries per type, ignoring the type filter. */
  types: Partial<Record<ActivityType, number>>;
}

type Raw = Record<string, unknown>;

const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined);
const whole = (v: unknown): number | undefined => {
  const n = Number(text(v));
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => list.find((x) => x === text(v));
const sizeOf = (v: unknown) => Math.min(Math.max(whole(v) ?? DEFAULT_SIZE, 1), MAX_SIZE);
const pageOf = (v: unknown) => Math.max(whole(v) ?? 1, 1);

/** Reads URL or query-string values. Anything unreadable falls back to the default, so a stale link still opens. */
export function parseBrowseQuery(raw: Raw): BrowseQuery {
  const sort = oneOf(TOPIC_SORTS, raw.sort) ?? 'title';
  return {
    q: (text(raw.q) ?? '').trim().slice(0, 200),
    kind: oneOf(TOPIC_KINDS, raw.kind),
    sort,
    dir: oneOf(['asc', 'desc'] as const, raw.dir) ?? (DESC_FIRST.has(sort) ? 'desc' : 'asc'),
    page: pageOf(raw.page),
    size: sizeOf(raw.size),
  };
}

export function parseActivityQuery(raw: Raw): ActivityQuery {
  return {
    type: oneOf(ACTIVITY_TYPES, raw.type),
    dir: oneOf(['asc', 'desc'] as const, raw.dir) ?? 'desc',
    page: pageOf(raw.page),
    size: sizeOf(raw.size),
  };
}

export function paginate<T>(items: readonly T[], page: number, size: number): ResultPage<T> {
  const pages = Math.max(Math.ceil(items.length / size), 1);
  const at = Math.min(Math.max(page, 1), pages);
  return { items: items.slice((at - 1) * size, at * size), total: items.length, page: at, size, pages };
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const haystack = (t: TopicSummary) => `${t.title} ${t.summary} ${t.tags.join(' ')}`.toLowerCase();

const compare: Record<TopicSort, (a: TopicSummary, b: TopicSummary) => number> = {
  title: (a, b) => a.title.localeCompare(b.title),
  updated: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
  created: (a, b) => a.createdAt.localeCompare(b.createdAt),
  links: (a, b) => a.counts.relations - b.counts.relations,
  sources: (a, b) => a.counts.references - b.counts.references,
  perspectives: (a, b) => a.counts.perspectives - b.counts.perspectives,
  kind: (a, b) => TOPIC_KINDS.indexOf(a.kind) - TOPIC_KINDS.indexOf(b.kind),
};

/** Search, filter, sort and page the topic list. Does not change its input. Ties fall back to title, then id, so a page never reshuffles. */
export function browseTopics(summaries: readonly TopicSummary[], query: BrowseQuery): TopicBrowse {
  const needles = words(query.q);
  const matched = needles.length ? summaries.filter((t) => needles.every((w) => haystack(t).includes(w))) : [...summaries];
  const kinds: TopicBrowse['kinds'] = {};
  for (const t of matched) kinds[t.kind] = (kinds[t.kind] ?? 0) + 1;
  const shown = query.kind ? matched.filter((t) => t.kind === query.kind) : matched;
  const sign = query.dir === 'desc' ? -1 : 1;
  shown.sort((a, b) => sign * compare[query.sort](a, b) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return { ...paginate(shown, query.page, query.size), all: summaries.length, kinds };
}

/** The log, filtered by type and ordered by time. The input is expected newest first. */
export function browseActivity(entries: readonly ActivityEntry[], query: ActivityQuery): ActivityBrowse {
  const types: ActivityBrowse['types'] = {};
  for (const e of entries) types[e.type] = (types[e.type] ?? 0) + 1;
  const shown = query.type ? entries.filter((e) => e.type === query.type) : [...entries];
  if (query.dir === 'asc') shown.reverse();
  return { ...paginate(shown, query.page, query.size), types };
}

/**
 * Page buttons to show: first, last, and a window around the current page, with
 * gaps as '…'. [1, '…', 4, 5, 6, '…', 20]. A gap never stands for just one page.
 */
export function pageWindow(page: number, pages: number, span = 1): (number | '…')[] {
  if (pages <= span * 2 + 5) return Array.from({ length: pages }, (_, i) => i + 1);
  let from = Math.max(2, Math.min(page - span, pages - span * 2 - 1));
  let to = Math.min(pages - 1, Math.max(page + span, span * 2 + 2));
  // A gap that would hide a single page is just that page.
  if (from === 3) from = 2;
  if (to === pages - 2) to = pages - 1;
  return [1, ...(from > 2 ? ['…' as const] : []), ...Array.from({ length: to - from + 1 }, (_, i) => from + i), ...(to < pages - 1 ? ['…' as const] : []), pages];
}
