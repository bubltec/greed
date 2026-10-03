import type { ContentSnapshot } from './entities.js';

/**
 * The persistence shape of every content type, declared once. The store adapters
 * (DynamoDB, in-memory), the snapshot loader and the BFF's generic CRUD all read
 * this table, so adding a type means adding a row here plus one spec in the BFF.
 */
export const ENTITY_NAMES = ['topic', 'reference', 'perspective', 'relation', 'outlet', 'page'] as const;
export type EntityName = (typeof ENTITY_NAMES)[number];

/** Which array of the ContentSnapshot holds the entity. */
export type Collection = keyof ContentSnapshot;

/** Enough to address one item: children also need their parent's id. */
export interface EntityRef {
  id: string;
  parentId?: string;
}

export interface EntityDef {
  name: EntityName;
  collection: Collection;
  /** Prefix for generated ids (see newId). */
  idPrefix: string;
  /** Entity this one hangs off; the item carries the parent's id in `parentField`. */
  parent?: EntityName;
  parentField?: string;
  /**
   * `status`: one row with a draft/published flag. `versioned`: one row holding a
   * working copy and a published copy (site pages).
   */
  lifecycle: 'status' | 'versioned';
  /** Storage address (single-table keys). */
  address(ref: EntityRef): { PK: string; SK: string };
  /** Whether a stored row's sort key belongs to this entity. */
  owns(sk: string): boolean;
}

const topicPk = (id: string) => `TOPIC#${id}`;

export const ENTITY_DEFS: Record<EntityName, EntityDef> = {
  topic: {
    name: 'topic',
    collection: 'topics',
    idPrefix: 'topic',
    lifecycle: 'status',
    address: ({ id }) => ({ PK: topicPk(id), SK: 'TOPIC' }),
    owns: (sk) => sk === 'TOPIC',
  },
  reference: {
    name: 'reference',
    collection: 'references',
    idPrefix: 'ref',
    parent: 'topic',
    parentField: 'topicId',
    lifecycle: 'status',
    address: ({ id, parentId }) => ({ PK: topicPk(parentId!), SK: `REF#${id}` }),
    owns: (sk) => sk.startsWith('REF#'),
  },
  perspective: {
    name: 'perspective',
    collection: 'perspectives',
    idPrefix: 'persp',
    parent: 'topic',
    parentField: 'topicId',
    lifecycle: 'status',
    address: ({ id, parentId }) => ({ PK: topicPk(parentId!), SK: `PERSP#${id}` }),
    owns: (sk) => sk.startsWith('PERSP#'),
  },
  relation: {
    name: 'relation',
    collection: 'relations',
    idPrefix: 'rel',
    lifecycle: 'status',
    address: ({ id }) => ({ PK: `REL#${id}`, SK: 'REL' }),
    owns: (sk) => sk === 'REL',
  },
  outlet: {
    name: 'outlet',
    collection: 'outlets',
    idPrefix: 'outlet',
    lifecycle: 'status',
    address: ({ id }) => ({ PK: `OUTLET#${id}`, SK: 'OUTLET' }),
    owns: (sk) => sk === 'OUTLET',
  },
  page: {
    name: 'page',
    collection: 'pages',
    idPrefix: 'page',
    lifecycle: 'versioned',
    address: ({ id }) => ({ PK: `PAGE#${id}`, SK: 'PAGE' }),
    owns: (sk) => sk === 'PAGE',
  },
};

export const ENTITY_LIST: EntityDef[] = ENTITY_NAMES.map((n) => ENTITY_DEFS[n]);

/** Entities that carry a draft/published status flag. */
export const STATUS_ENTITY_NAMES = ENTITY_LIST.filter((d) => d.lifecycle === 'status').map((d) => d.name);

/** All items of an entity in a snapshot. */
export function itemsOf(snapshot: ContentSnapshot, def: EntityDef): { id: string }[] {
  return ((snapshot[def.collection] ?? []) as { id: string }[]);
}

export function refOf(def: EntityDef, item: { id: string }): EntityRef {
  const parentId = def.parentField ? ((item as unknown as Record<string, string>)[def.parentField]) : undefined;
  return { id: item.id, parentId };
}
