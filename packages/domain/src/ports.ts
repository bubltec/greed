import type { ContentSnapshot } from './entities.js';
import { type Collection, ENTITY_LIST, ENTITY_DEFS, type EntityName, type EntityRef } from './entity-defs.js';

/** Something to delete: the entity type plus how to address it. */
export interface RemoveTarget {
  entity: EntityName;
  ref: EntityRef;
}

/**
 * Persistence port. The BFF depends on this, never on DynamoDB directly, so
 * the in-memory fake below can stand in for tests. It is generic over the
 * entity table in entity-defs.ts: no per-type methods. Cascades (a topic's
 * references, perspectives and relations) are the service's job; the store
 * only writes and deletes what it is told to.
 */
export interface ContentStore {
  loadAll(): Promise<ContentSnapshot>;
  put(entity: EntityName, item: { id: string }): Promise<void>;
  remove(targets: RemoveTarget[]): Promise<void>;
}

export class InMemoryContentStore implements ContentStore {
  private data = new Map<Collection, Map<string, { id: string }>>();

  constructor(seed?: Partial<ContentSnapshot>) {
    for (const def of ENTITY_LIST) {
      const rows = new Map<string, { id: string }>();
      for (const item of (seed?.[def.collection] ?? []) as { id: string }[]) rows.set(item.id, item);
      this.data.set(def.collection, rows);
    }
  }

  async loadAll(): Promise<ContentSnapshot> {
    const snapshot: Record<string, unknown[]> = {};
    for (const def of ENTITY_LIST) snapshot[def.collection] = [...this.data.get(def.collection)!.values()];
    return structuredClone(snapshot) as unknown as ContentSnapshot;
  }

  async put(entity: EntityName, item: { id: string }) {
    this.data.get(ENTITY_DEFS[entity].collection)!.set(item.id, structuredClone(item));
  }

  async remove(targets: RemoveTarget[]) {
    for (const { entity, ref } of targets) this.data.get(ENTITY_DEFS[entity].collection)!.delete(ref.id);
  }
}
