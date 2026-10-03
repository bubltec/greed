import type { ContentIndex, EntityDef, EntityName, EntityRef, Status } from '@greed/domain';

/** What a hook can see. `index` is the content as it was when the write began. */
export interface EntityCtx<Item = any> {
  index: ContentIndex;
  by: string;
  now: string;
  /** The stored item when updating or deleting; undefined on create. */
  existing?: Item;
  /** The parent item (a topic, for references and perspectives). */
  parent?: any;
}

/** A stored item, as far as the generic code can see. */
export type AnyItem = { id: string; [key: string]: any };

/** A side effect of a write beyond the item itself: another row to save or delete. */
export type Effect = { put: { entity: EntityName; item: AnyItem } } | { remove: { entity: EntityName; ref: EntityRef } };

type Args = Record<string, unknown>;

/** How one operation is exposed as an MCP tool. Omit the operation to keep it off MCP. */
export interface McpOp {
  /** Tool name; defaults to `<verb>_<entity>`. */
  name?: string;
  title?: string;
  /** Written for the model that calls the tool; defaults to a generic sentence. */
  description?: string;
  /** Name of the argument carrying the item id; defaults to `<entity>Id`. */
  idArg?: string;
  /** Create only: argument values used when the caller omits them. */
  defaults?: Args;
}

export interface McpConfig {
  get?: McpOp | true;
  create?: McpOp | true;
  update?: McpOp | true;
  /** Delete in any state (rare: prefer `deleteDraft`). */
  delete?: McpOp | true;
  /** Include in the shared `delete_draft` tool: deletes only items still in draft. */
  deleteDraft?: boolean;
  publish?: McpOp | true;
  /** Descriptions for input fields, keyed by dotted path ("sections.points.text"). */
  fields?: Record<string, string>;
  /** Input fields to leave out of the tool schemas (`status` is always left out). */
  omit?: string[];
  /** Shapes what write tools return; defaults to the presented result. */
  result?: (presented: any, item: any) => unknown;
}

/**
 * Everything the generic CRUD needs to know about one content type, beyond the
 * persistence shape in packages/domain/src/entity-defs.ts. Registering a spec
 * in entities/index.ts gives the type REST endpoints, validation, cascading
 * deletes, draft/publish handling and (with `mcp`) connector tools. Nothing
 * else needs to change.
 */
export interface EntitySpec<Item extends { id: string } = any, Input extends object = any> {
  def: EntityDef;
  /** Validated request body; its decorators also drive the MCP tool schemas. */
  dto: new () => Input;
  /** URL segment under /api (a child nests under its parent's: topics/:id/references). */
  route: string;

  /**
   * Item fields from validated input. Enforce integrity here (throw
   * BadRequestException); id, parent link, timestamps and status are added by the
   * service. Not used by `versioned` entities, which implement `build`.
   */
  fields?(input: Input, ctx: EntityCtx<Item>): Partial<Item>;
  /** Versioned entities: the whole item, since the working/published copies are theirs to manage. */
  build?(input: Input, ctx: EntityCtx<Item>): Item;
  /** Versioned entities: the item as it is after publishing. */
  publishItem?(item: Item, ctx: EntityCtx<Item>): Item;

  /** The item as editable input (default: the DTO's fields, read off the item). Used to merge partial updates. */
  toInput?(item: Item): Record<string, unknown>;

  /** Id for a new item; default is `newId(def.idPrefix)`. */
  makeId?(input: Input, ctx: EntityCtx<Item>): string;
  /** Status of a new item when the input gives none; default is the parent's, else draft. */
  defaultStatus?(input: Input, ctx: EntityCtx<Item>): Status;

  /** Ids are fixed (site pages): update creates the row on first save, and the type can't be created or deleted. */
  fixedIds?: { all(): readonly string[]; has(id: string): boolean };

  /** Extra rows to write or delete when an item is deleted. Children are cascaded automatically. */
  onDelete?(item: Item, ctx: EntityCtx<Item>): Effect[];

  /**
   * What reads and writes return for an item (default: the item). `ctx.index`
   * is fresh, so a child can return its parent's refreshed view.
   */
  present?(item: Item, ctx: EntityCtx<Item>): unknown;

  /** Enables publish for status entities: which drafts go live with the item. */
  publish?: {
    cascade?(item: Item, ctx: EntityCtx<Item>, includeChildren: boolean): { type: EntityName; id: string }[];
  };

  mcp?: McpConfig;
}

export const defineEntity = <Item extends { id: string }, Input extends object>(
  spec: EntitySpec<Item, Input>,
): EntitySpec<Item, Input> => spec;
