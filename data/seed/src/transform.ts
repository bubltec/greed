import { createHash } from 'node:crypto';
import {
  type ContentSnapshot,
  isTopicKind,
  parsePoint,
  type Reference,
  type Relation,
  type RelationKind,
  type RelationProvenance,
  type Topic,
} from '@greed/domain';

/**
 * Converts the export of the original Claude artifact ("Power, Money &
 * Oversight — Index": items + relations collections) into the site's content
 * model. Pure and deterministic: the same export always yields the same ids,
 * so re-running the seed never duplicates anything.
 */

export interface LegacyItem {
  id: string;
  type: string;
  title: string;
  summary: string;
  sections: { label: string; items: string[] }[];
  disputed?: string;
  notes?: string;
}

export interface LegacyRelation {
  id: string;
  from: string;
  to: string;
  note: string;
  source: string;
}

/** When the artifact was built; the export carries no per-row timestamps. */
export const IMPORTED_AT = '2026-09-21T12:00:00.000Z';
export const IMPORTED_BY = 'import';

const shortHash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** Relation ids in the export encode the link type in their suffix. */
export function relationKindFromLegacyId(id: string): RelationKind {
  if (/same-actor|same-org|author-of|litigator-overlap/.test(id)) return 'same-actor';
  if (/implementation-of|cause|led-to/.test(id)) return 'cause-effect';
  if (/same-war|same-episode|shared-period|same-location|same-agency/.test(id)) return 'same-context';
  if (/shared-|administration-pattern|traditional-values/.test(id)) return 'shared-mechanism';
  return 'related';
}

export function provenanceFromLegacy(source: string): RelationProvenance {
  if (source === 'doc' || source === 'doc-sourced') return 'sourced';
  if (source === 'manual') return 'editor';
  return 'inferred';
}

export interface TransformReport {
  topics: number;
  references: number;
  referencesWithoutUrl: number;
  relations: number;
  droppedRelations: string[];
}

export function transform(
  items: LegacyItem[],
  relations: LegacyRelation[],
): { snapshot: ContentSnapshot; report: TransformReport } {
  // Imported content was already public in the original index, so it arrives published.
  const stamp = {
    createdAt: IMPORTED_AT,
    updatedAt: IMPORTED_AT,
    updatedBy: IMPORTED_BY,
    status: 'published' as const,
    publishedAt: IMPORTED_AT,
  };
  const topics: Topic[] = [];
  const references: Reference[] = [];

  for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    const refsByKey = new Map<string, Reference>();
    const cite = (label: string, url?: string): string => {
      const key = (url ?? label).toLowerCase();
      let ref = refsByKey.get(key);
      if (!ref) {
        ref = { id: `ref_${shortHash(`${item.id}|${key}`)}`, topicId: item.id, label, url, ...stamp };
        refsByKey.set(key, ref);
      }
      return ref.id;
    };

    const summary = parsePoint(item.summary ?? '');
    for (const c of summary.citations) cite(c.label, c.url);

    topics.push({
      id: item.id,
      kind: isTopicKind(item.type) ? item.type : 'case',
      title: item.title.trim(),
      summary: summary.text,
      sections: (item.sections ?? []).map((section, i) => ({
        id: `sec_${shortHash(`${item.id}|${i}|${section.label}`)}`,
        label: section.label,
        points: (section.items ?? []).map((raw) => {
          const point = parsePoint(raw);
          return {
            text: point.text,
            refIds: [...new Set(point.citations.map((c) => cite(c.label, c.url)))],
          };
        }),
      })),
      disputed: (item.disputed ?? '').trim(),
      notes: (item.notes ?? '').trim(),
      tags: [],
      ...stamp,
    });
    references.push(...refsByKey.values());
  }

  const topicIds = new Set(topics.map((t) => t.id));
  const dropped: string[] = [];
  const outRelations: Relation[] = [];
  for (const r of [...relations].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!topicIds.has(r.from) || !topicIds.has(r.to) || r.from === r.to) {
      dropped.push(r.id);
      continue;
    }
    outRelations.push({
      id: `rel_${shortHash(r.id)}`,
      fromId: r.from,
      toId: r.to,
      kind: relationKindFromLegacyId(r.id),
      note: r.note ?? '',
      provenance: provenanceFromLegacy(r.source),
      ...stamp,
    });
  }

  return {
    snapshot: { topics, references, perspectives: [], relations: outRelations },
    report: {
      topics: topics.length,
      references: references.length,
      referencesWithoutUrl: references.filter((r) => !r.url).length,
      relations: outRelations.length,
      droppedRelations: dropped,
    },
  };
}
