import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LegacyItem, LegacyRelation } from './transform.js';

const SOURCE = fileURLToPath(new URL('../source/', import.meta.url));

function readDir<T>(dir: string): T[] {
  return readdirSync(join(SOURCE, dir))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ id: basename(f, '.json'), ...JSON.parse(readFileSync(join(SOURCE, dir, f), 'utf8')) }));
}

/** The artifact export: one JSON file per document, named by its id. */
export function loadSource(): { items: LegacyItem[]; relations: LegacyRelation[] } {
  return { items: readDir<LegacyItem>('items'), relations: readDir<LegacyRelation>('relations') };
}

/**
 * One-sentence closing notes that replace the original multi-paragraph
 * "disputed" text, keyed by topic id (source/disputed-condensed.json).
 */
export function loadCondensedNotes(): Record<string, string> {
  return JSON.parse(readFileSync(join(SOURCE, 'disputed-condensed.json'), 'utf8')) as Record<string, string>;
}

export interface ReferenceUrl {
  topicId: string;
  referenceId: string;
  label: string;
  /** null when no article by that outlet could be found. */
  url: string | null;
  title: string | null;
  confidence: 'high' | 'medium' | 'low';
  note: string;
}

/**
 * Researched article links for sources the original index cited by name only
 * (source/reference-urls.json).
 */
export function loadReferenceUrls(): ReferenceUrl[] {
  return JSON.parse(readFileSync(join(SOURCE, 'reference-urls.json'), 'utf8')) as ReferenceUrl[];
}
