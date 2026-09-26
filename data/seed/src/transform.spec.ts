import { describe, expect, it } from 'vitest';
import { loadSource } from './load-source.js';
import { relationKindFromLegacyId, transform } from './transform.js';

describe('transform (real export)', () => {
  const { items, relations } = loadSource();
  const { snapshot, report } = transform(items, relations);

  it('keeps every topic and every relation whose ends exist', () => {
    expect(report.topics).toBe(items.length);
    expect(report.relations + report.droppedRelations.length).toBe(relations.length);
  });

  it('turns inline citations into references linked from points', () => {
    expect(report.references).toBeGreaterThan(100);
    const refIds = new Set(snapshot.references.map((r) => r.id));
    for (const t of snapshot.topics) {
      for (const s of t.sections) {
        for (const p of s.points) {
          for (const id of p.refIds) expect(refIds.has(id)).toBe(true);
          expect(p.text).not.toMatch(/\(https?:\/\/[^)]*\)\)?$/);
        }
      }
    }
  });

  it('is deterministic', () => {
    expect(transform(items, relations).snapshot).toEqual(snapshot);
  });
});

describe('relationKindFromLegacyId', () => {
  it('reads the link type from the id suffix', () => {
    expect(relationKindFromLegacyId('slf-cooper-ad__slf-funding-structure__same-org')).toBe('same-actor');
    expect(relationKindFromLegacyId('nspm7-in-practice__antifa__implementation-of')).toBe('cause-effect');
    expect(relationKindFromLegacyId('x__y__same-war')).toBe('same-context');
    expect(relationKindFromLegacyId('a__b__shared-framing')).toBe('shared-mechanism');
    expect(relationKindFromLegacyId('a__b__oil11')).toBe('related');
  });
});
