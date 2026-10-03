import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ContentIndex,
  type ContentStore,
  ENTITY_DEFS,
  type EntityName,
  type EntityRef,
  itemsOf,
  newId,
  type PageId,
  type PageView,
  publicPage,
  type RemoveTarget,
  type Page,
  refOf,
  type Status,
  statusOf,
  workingPage,
} from '@greed/domain';
import { cacheTtlMs } from '../env.js';
import { CONTENT_STORE } from './content.tokens.js';
import type { SetStatusDto } from './content.dto.js';
import type { EntityCtx, EntitySpec } from './entity.js';
import { ENTITIES } from './entities/index.js';

type Item = { id: string; status?: Status; [key: string]: any };

/** A write's outcome: the stored item, and what callers should show for it (see `present`). */
export interface Written {
  item: Item;
  result: unknown;
}

/**
 * All reads go through one cached ContentIndex; every write invalidates it.
 *
 * Writes are generic: `create`, `update`, `remove`, `removeDraft`, `setStatus`
 * and `publish` work on any entity registered in entities/index.ts, using its
 * spec for validation and integrity (references belong to their topic, no self
 * or duplicate relations, deleting a reference unlinks it everywhere) so every
 * client gets them, not just the web CMS.
 *
 * Publishing: new topics start as drafts. A new reference, perspective or link
 * takes its topic's status unless one is given (the CMS adds sources to a live
 * topic live; the MCP connector always passes `draft`). Updates keep the
 * current status unless one is given.
 */
@Injectable()
export class ContentService {
  private cache?: { index: ContentIndex; at: number };

  constructor(@Inject(CONTENT_STORE) private readonly store: ContentStore) {}

  async index(fresh = false): Promise<ContentIndex> {
    if (!fresh && this.cache && Date.now() - this.cache.at < cacheTtlMs()) return this.cache.index;
    const index = new ContentIndex(await this.store.loadAll());
    this.cache = { index, at: Date.now() };
    return index;
  }

  private invalidate() {
    this.cache = undefined;
  }

  // Generic CRUD ------------------------------------------------------------

  /** Reads one item as `present` shows it (a topic reads as its full view), drafts included. */
  async get(name: EntityName, id: string, by = ''): Promise<unknown> {
    const spec = ENTITIES[name];
    const index = await this.index(true);
    const item = this.locate(spec, index, { id });
    return spec.present ? spec.present(item, this.ctx(index, by, { existing: item })) : item;
  }

  /** The stored item itself (not its presentation), or 404. */
  async find(name: EntityName, id: string): Promise<Item> {
    return this.locate(ENTITIES[name], await this.index(true), { id });
  }

  /** `parentId` is required for children (a reference needs its topic). */
  async create(name: EntityName, input: Record<string, any>, by: string, parentId?: string): Promise<Written> {
    const spec = ENTITIES[name];
    if (spec.fixedIds) throw new BadRequestException(`A ${name} can't be created; update it instead`);
    const index = await this.index(true);
    const ctx = this.ctx(index, by, { parent: this.parentOf(spec, index, parentId) });
    const id = spec.makeId?.(input, ctx) ?? newId(spec.def.idPrefix);
    return this.save(spec, this.compose(spec, id, input, ctx), by);
  }

  async update(name: EntityName, ref: EntityRef, input: Record<string, any>, by: string): Promise<Written> {
    const spec = ENTITIES[name];
    const index = await this.index(true);
    const existing = this.locate(spec, index, ref);
    const parent = spec.def.parentField ? this.parentOf(spec, index, existing[spec.def.parentField]) : undefined;
    const ctx = this.ctx(index, by, { existing, parent });
    return this.save(spec, this.compose(spec, existing.id, input, ctx), by);
  }

  /**
   * Deletes an item and everything that hangs off it (a topic takes its references,
   * perspectives and links). Returns the parent's refreshed presentation, if it has one.
   */
  async remove(name: EntityName, ref: EntityRef, by: string): Promise<unknown> {
    const spec = ENTITIES[name];
    if (spec.fixedIds) throw new BadRequestException(`A ${name} can't be deleted`);
    const index = await this.index(true);
    const existing = this.locate(spec, index, ref);
    const ctx = this.ctx(index, by, { existing, parent: spec.def.parent ? this.parentOf(spec, index, existing[spec.def.parentField!]) : undefined });

    const removals: RemoveTarget[] = [];
    const cascade = (entity: EntityName, item: Item) => {
      removals.push({ entity, ref: refOf(ENTITY_DEFS[entity], item) });
      for (const child of Object.values(ENTITY_DEFS).filter((d) => d.parent === entity)) {
        for (const c of itemsOf(index.snapshot, child) as Item[]) {
          if (c[child.parentField!] === item.id) cascade(child.name, c);
        }
      }
    };
    cascade(name, existing);

    const puts: { entity: EntityName; item: { id: string } }[] = [];
    for (const effect of spec.onDelete?.(existing, ctx) ?? []) {
      if ('remove' in effect) removals.push(effect.remove);
      else puts.push(effect.put);
    }
    await this.store.remove(removals);
    for (const { entity, item } of puts) await this.store.put(entity, item);
    this.invalidate();

    if (!spec.def.parent) return undefined;
    const fresh = await this.index(true);
    const parentSpec = ENTITIES[spec.def.parent];
    const parent = this.locate(parentSpec, fresh, { id: existing[spec.def.parentField!] });
    return parentSpec.present ? parentSpec.present(parent, this.ctx(fresh, by, { existing: parent })) : parent;
  }

  /** Deletes an item only while it is a draft; published items can only be removed in the web editor. */
  async removeDraft(name: EntityName, id: string, by: string): Promise<{ deleted: string; type: EntityName }> {
    const spec = ENTITIES[name];
    if (spec.def.lifecycle !== 'status') throw new BadRequestException(`A ${name} has no drafts to delete`);
    const existing = this.locate(spec, await this.index(true), { id });
    if (statusOf(existing) !== 'draft') {
      throw new BadRequestException(`${name} "${id}" is published; only drafts can be deleted here`);
    }
    await this.remove(name, refOf(spec.def, existing), by);
    return { deleted: id, type: name };
  }

  /** Sets the status of any mix of items. Unknown ids fail the whole call before anything is written. */
  async setStatus(input: SetStatusDto, by: string): Promise<{ updated: number }> {
    const { snapshot } = await this.index(true);
    const targets = input.items.map((item) => {
      const found = (itemsOf(snapshot, ENTITY_DEFS[item.type]) as Item[]).find((i) => i.id === item.id);
      if (!found) throw new NotFoundException(`No ${item.type} "${item.id}"`);
      return { type: item.type, found };
    });
    const now = new Date().toISOString();
    let updated = 0;
    for (const { type, found } of targets) {
      if (statusOf(found) === input.status) continue;
      const next: Item = { ...found, ...stamp(input.status, found), updatedAt: now, updatedBy: by };
      await this.store.put(type, next);
      updated++;
    }
    this.invalidate();
    return { updated };
  }

  /**
   * Makes an item public: a status entity goes live together with whatever drafts its
   * spec's `publish.cascade` names (a topic takes its sources, perspectives and links);
   * a versioned one (a site page) publishes its working copy.
   */
  async publish(name: EntityName, id: string, by: string, includeChildren = true): Promise<unknown> {
    const spec = ENTITIES[name];
    const index = await this.index(true);
    const existing = this.locate(spec, index, { id });
    const ctx = this.ctx(index, by, { existing });
    if (spec.def.lifecycle === 'versioned') {
      if (!spec.publishItem) throw new BadRequestException(`A ${name} can't be published`);
      return (await this.save(spec, spec.publishItem(existing, ctx), by)).result;
    }
    if (!spec.publish) throw new BadRequestException(`A ${name} can't be published directly; use set_status`);
    const items = [{ type: name, id }, ...spec.publish.cascade?.(existing, ctx, includeChildren) ?? []];
    await this.setStatus({ status: 'published', items }, by);
    return this.get(name, id, by);
  }

  // Internals ---------------------------------------------------------------

  private ctx(index: ContentIndex, by: string, extra: Partial<EntityCtx> = {}): EntityCtx {
    return { index, by, now: new Date().toISOString(), ...extra };
  }

  /** The stored item, or 404. Fixed-id entities (pages) that were never saved read as an empty stub. */
  private locate(spec: EntitySpec, index: ContentIndex, ref: EntityRef): Item {
    const { def } = spec;
    if (def.parent && ref.parentId) this.parentOf(spec, index, ref.parentId);
    const found = (itemsOf(index.snapshot, def) as Item[]).find((i) => i.id === ref.id);
    if (found) {
      if (def.parentField && ref.parentId && found[def.parentField] !== ref.parentId) {
        throw new NotFoundException(`No ${def.name} "${ref.id}"`);
      }
      return found;
    }
    if (spec.fixedIds?.has(ref.id)) return { id: ref.id };
    throw new NotFoundException(`No ${def.name} "${ref.id}"`);
  }

  private parentOf(spec: EntitySpec, index: ContentIndex, parentId: string | undefined): Item | undefined {
    const { parent } = spec.def;
    if (!parent) return undefined;
    if (!parentId) throw new BadRequestException(`A ${spec.def.name} needs its ${parent}`);
    return this.locate(ENTITIES[parent], index, { id: parentId });
  }

  /** Builds the item to store: the spec's fields plus id, parent link, timestamps and status. */
  private compose(spec: EntitySpec, id: string, input: Record<string, any>, ctx: EntityCtx): Item {
    const { def } = spec;
    if (def.lifecycle === 'versioned') return spec.build!(input, ctx);
    const { existing, parent, now, by } = ctx;
    // Fields first: they validate, and defaultStatus may rely on that.
    const fields = spec.fields!(input, ctx);
    const status: Status =
      input.status ?? (existing ? statusOf(existing) : (spec.defaultStatus?.(input, ctx) ?? (parent ? statusOf(parent) : 'draft')));
    return {
      ...existing,
      ...fields,
      id,
      ...(def.parentField ? { [def.parentField]: parent!.id } : {}),
      ...stamp(status, existing),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: by,
    };
  }

  private async save(spec: EntitySpec, item: Item, by: string): Promise<Written> {
    await this.store.put(spec.def.name, item);
    this.invalidate();
    const index = await this.index(true);
    return { item, result: spec.present ? spec.present(item, this.ctx(index, by, { existing: item })) : item };
  }

  // Pages (reads) -----------------------------------------------------------

  private async findPage(id: PageId, fresh = false): Promise<Page | undefined> {
    return (await this.index(fresh)).snapshot.pages?.find((p) => p.id === id);
  }

  /** The live page for readers, or the editor's working copy in preview. */
  async page(id: PageId, preview: boolean): Promise<PageView> {
    return preview ? workingPage(id, await this.findPage(id, true)) : publicPage(id, await this.findPage(id));
  }
}

/** Status fields for a write; `publishedAt` moves only when something becomes published. */
function stamp(status: Status, previous: { status?: Status; publishedAt?: string } | undefined) {
  const wasPublished = previous ? statusOf(previous) === 'published' : false;
  return {
    status,
    publishedAt:
      status === 'published'
        ? wasPublished
          ? previous?.publishedAt
          : new Date().toISOString()
        : previous?.publishedAt,
  };
}
