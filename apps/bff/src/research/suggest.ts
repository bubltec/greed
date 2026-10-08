import type { Reference } from '@greed/domain';
import type { ContentService } from '../content/content.service.js';
import { type ResearchDeps, type ResearchHit, suggestReferenceUrls } from './research.js';

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const CONCURRENCY = 4;
const KEEP = 3;

export interface UrlSuggestionRow {
  referenceId: string;
  topicId: string;
  topicTitle: string;
  label: string;
  publishedOn?: string;
  candidates: (Pick<ResearchHit, 'url' | 'title' | 'outlet' | 'publishedDate'> & { match: 'strong' | 'possible' })[];
  /** Why there is nothing to review: the search failed, or found nothing. */
  note?: string;
}

export interface UrlSuggestionBatch {
  configured: boolean;
  /** References with no URL (the find_gaps sourcesMissingUrl list). */
  missing: number;
  checked: number;
  /** Not looked at yet; call again with a higher limit or a topicId. */
  remaining: number;
  suggestions: UrlSuggestionRow[];
  message?: string;
}

export interface BatchOptions {
  topicId?: string;
  limit?: number;
}

/**
 * Candidate URLs for every reference saved without one. Read-only: an editor
 * checks each candidate really is the cited piece, then saves it with
 * update_reference. A "strong" match means the outlet's name is in the
 * reference's label and the dates agree; it is still a lead, not a verdict.
 */
export async function suggestMissingUrls(content: ContentService, deps: ResearchDeps, options: BatchOptions = {}): Promise<UrlSuggestionBatch> {
  const snapshot = (await content.index(true)).snapshot;
  const titles = new Map(snapshot.topics.map((t) => [t.id, t.title]));
  const missing = snapshot.references.filter((r) => !r.url && (!options.topicId || r.topicId === options.topicId));
  const base = { missing: missing.length, checked: 0, remaining: missing.length, suggestions: [] as UrlSuggestionRow[] };
  if (!deps.search) return { ...base, configured: false, message: 'Web search is not configured for this stage.' };
  if (missing.length === 0) return { ...base, configured: true, message: 'Every reference has a URL.' };

  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const batch = missing.slice(0, limit);
  const rows: UrlSuggestionRow[] = Array.from({ length: batch.length });
  let next = 0;
  async function worker(): Promise<void> {
    while (next < batch.length) {
      const i = next++;
      rows[i] = await suggestOne(content, deps, batch[i]!, titles.get(batch[i]!.topicId) ?? batch[i]!.topicId, snapshot.references);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
  return { configured: true, missing: missing.length, checked: batch.length, remaining: missing.length - batch.length, suggestions: rows };
}

async function suggestOne(content: ContentService, deps: ResearchDeps, ref: Reference, topicTitle: string, all: readonly Reference[]): Promise<UrlSuggestionRow> {
  const row: UrlSuggestionRow = { referenceId: ref.id, topicId: ref.topicId, topicTitle, label: ref.label, ...(ref.publishedOn ? { publishedOn: ref.publishedOn } : {}), candidates: [] };
  try {
    const found = await suggestReferenceUrls(content, ref.id, deps);
    // A link another source on this topic already uses is the wrong answer for this one.
    const taken = new Set(all.filter((r) => r.topicId === ref.topicId && r.url).map((r) => r.url));
    row.candidates = found.candidates
      .filter((c) => !taken.has(c.url))
      .slice(0, KEEP)
      .map((c) => ({ url: c.url, title: c.title, outlet: c.outlet, publishedDate: c.publishedDate, match: matches(ref, c) ? 'strong' : 'possible' }));
    if (row.candidates.length === 0) row.note = found.message ?? 'No candidate found on the open outlets.';
  } catch (err) {
    row.note = `Search failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  return row;
}

/** The outlet is named in the label (either way round), and the dates do not disagree. */
function matches(ref: Reference, hit: ResearchHit): boolean {
  const label = ref.label.toLowerCase();
  const outlet = hit.outlet?.toLowerCase();
  const named = Boolean(outlet) && (label.includes(outlet!) || outlet!.includes(label));
  // Month precision at most: a reference dated 2026-10 matches any October 2026 hit; a bare year matches the year.
  const dated = !ref.publishedOn || !hit.publishedDate || hit.publishedDate.startsWith(ref.publishedOn.slice(0, 7));
  return named && dated;
}
