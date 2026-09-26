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
