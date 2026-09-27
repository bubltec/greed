import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ContentIndex,
  type ContentStore,
  newId,
  type Perspective,
  type Reference,
  type Relation,
  type Section,
  type Page,
  type PageId,
  type PageView,
  publicPage,
  type Status,
  statusOf,
  workingPage,
  type Topic,
  type TopicView,
  uniqueSlug,
} from '@greed/domain';
import { cacheTtlMs } from '../env.js';
import { CONTENT_STORE } from './content.tokens.js';
import type {
  PageInputDto,
  PerspectiveInputDto,
  ReferenceInputDto,
  RelationInputDto,
  SetStatusDto,
  TopicInputDto,
} from './content.dto.js';

/**
 * All reads go through one cached ContentIndex; every write invalidates it.
 * Integrity rules (refs belong to their topic, no self or duplicate relations,
 * deleting a reference unlinks it everywhere) live here so every client gets
 * them, not just the web CMS.
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

  async view(topicId: string, fresh = false): Promise<TopicView> {
    const view = (await this.index(fresh)).view(topicId);
    if (!view) throw new NotFoundException(`No topic "${topicId}"`);
    return view;
  }

  // Topics ------------------------------------------------------------------

  async createTopic(input: TopicInputDto, by: string): Promise<TopicView> {
    const index = await this.index(true);
    const taken = new Set(index.topicsById.keys());
    const id = input.id ? input.id : uniqueSlug(input.title, taken);
    if (taken.has(id)) throw new BadRequestException(`Topic id "${id}" already exists`);
    const now = new Date().toISOString();
    const status = input.status ?? 'draft';
    const topic: Topic = {
      id,
      ...this.topicFields(input, new Set()),
      ...stamp(status, undefined),
      createdAt: now,
      updatedAt: now,
      updatedBy: by,
    };
    await this.store.putTopic(topic);
    this.invalidate();
    return this.view(id, true);
  }

  async updateTopic(id: string, input: TopicInputDto, by: string): Promise<TopicView> {
    const current = await this.view(id, true);
    const refIds = new Set(current.references.map((r) => r.id));
    const topic: Topic = {
      ...current.topic,
      ...this.topicFields(input, refIds),
      ...stamp(input.status ?? statusOf(current.topic), current.topic),
      id,
      updatedAt: new Date().toISOString(),
      updatedBy: by,
    };
    await this.store.putTopic(topic);
    this.invalidate();
    return this.view(id, true);
  }

  async deleteTopic(id: string): Promise<void> {
    await this.view(id, true);
    await this.store.deleteTopic(id);
    this.invalidate();
  }

  private topicFields(input: TopicInputDto, validRefIds: Set<string>) {
    const sections: Section[] = input.sections.map((s) => ({
      id: s.id || newId('sec'),
      label: s.label.trim(),
      points: s.points
        .filter((p) => p.text.trim())
        .map((p) => ({
          text: p.text.trim(),
          // On create there are no refs yet; on update, drop ids that aren't this topic's.
          refIds: p.refIds.filter((r) => validRefIds.has(r)),
        })),
    }));
    return {
      kind: input.kind,
      title: input.title.trim(),
      summary: input.summary.trim(),
      sections,
      disputed: input.disputed.trim(),
      notes: input.notes.trim(),
      tags: [...new Set(input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))],
    };
  }

  // References --------------------------------------------------------------

  async saveReference(
    topicId: string,
    referenceId: string | undefined,
    input: ReferenceInputDto,
    by: string,
  ): Promise<TopicView> {
    const current = await this.view(topicId, true);
    const existing = referenceId
      ? current.references.find((r) => r.id === referenceId)
      : undefined;
    if (referenceId && !existing) throw new NotFoundException(`No reference "${referenceId}"`);
    const now = new Date().toISOString();
    const reference: Reference = {
      id: existing?.id ?? newId('ref'),
      topicId,
      label: input.label.trim(),
      url: input.url?.trim() || undefined,
      publishedOn: input.publishedOn || undefined,
      excerpt: input.excerpt?.trim() || undefined,
      note: input.note?.trim() || undefined,
      ...stamp(input.status ?? (existing ? statusOf(existing) : statusOf(current.topic)), existing),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: by,
    };
    await this.store.putReference(reference);
    this.invalidate();
    return this.view(topicId, true);
  }

  async deleteReference(topicId: string, referenceId: string, by: string): Promise<TopicView> {
    const current = await this.view(topicId, true);
    if (!current.references.some((r) => r.id === referenceId)) {
      throw new NotFoundException(`No reference "${referenceId}"`);
    }
    await this.store.deleteReference(topicId, referenceId);
    const now = new Date().toISOString();
    const drop = (ids: string[]) => ids.filter((id) => id !== referenceId);
    if (current.topic.sections.some((s) => s.points.some((p) => p.refIds.includes(referenceId)))) {
      await this.store.putTopic({
        ...current.topic,
        sections: current.topic.sections.map((s) => ({
          ...s,
          points: s.points.map((p) => ({ ...p, refIds: drop(p.refIds) })),
        })),
        updatedAt: now,
        updatedBy: by,
      });
    }
    for (const p of current.perspectives) {
      if (p.refIds.includes(referenceId)) {
        await this.store.putPerspective({ ...p, refIds: drop(p.refIds), updatedAt: now, updatedBy: by });
      }
    }
    this.invalidate();
    return this.view(topicId, true);
  }

  // Perspectives ------------------------------------------------------------

  async savePerspective(
    topicId: string,
    perspectiveId: string | undefined,
    input: PerspectiveInputDto,
    by: string,
  ): Promise<TopicView> {
    const current = await this.view(topicId, true);
    const existing = perspectiveId
      ? current.perspectives.find((p) => p.id === perspectiveId)
      : undefined;
    if (perspectiveId && !existing) throw new NotFoundException(`No perspective "${perspectiveId}"`);
    const refIds = new Set(current.references.map((r) => r.id));
    const unknown = input.refIds.filter((r) => !refIds.has(r));
    if (unknown.length) {
      throw new BadRequestException(`References not on this topic: ${unknown.join(', ')}`);
    }
    const now = new Date().toISOString();
    const perspective: Perspective = {
      id: existing?.id ?? newId('persp'),
      topicId,
      stance: input.stance,
      holder: input.holder.trim(),
      body: input.body.trim(),
      refIds: [...new Set(input.refIds)],
      ...stamp(input.status ?? (existing ? statusOf(existing) : statusOf(current.topic)), existing),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: by,
    };
    await this.store.putPerspective(perspective);
    this.invalidate();
    return this.view(topicId, true);
  }

  async deletePerspective(topicId: string, perspectiveId: string): Promise<TopicView> {
    const current = await this.view(topicId, true);
    if (!current.perspectives.some((p) => p.id === perspectiveId)) {
      throw new NotFoundException(`No perspective "${perspectiveId}"`);
    }
    await this.store.deletePerspective(topicId, perspectiveId);
    this.invalidate();
    return this.view(topicId, true);
  }

  // Relations ---------------------------------------------------------------

  async saveRelation(
    relationId: string | undefined,
    input: RelationInputDto,
    by: string,
  ): Promise<Relation> {
    const index = await this.index(true);
    for (const id of [input.fromId, input.toId]) {
      if (!index.topicsById.has(id)) throw new BadRequestException(`No topic "${id}"`);
    }
    if (input.fromId === input.toId) throw new BadRequestException('A topic cannot relate to itself');
    const existing = relationId
      ? index.snapshot.relations.find((r) => r.id === relationId)
      : undefined;
    if (relationId && !existing) throw new NotFoundException(`No relation "${relationId}"`);
    const duplicate = index.snapshot.relations.find(
      (r) =>
        r.id !== relationId &&
        r.kind === input.kind &&
        ((r.fromId === input.fromId && r.toId === input.toId) ||
          (r.fromId === input.toId && r.toId === input.fromId)),
    );
    if (duplicate) throw new BadRequestException('That relation already exists');
    const now = new Date().toISOString();
    const relation: Relation = {
      id: existing?.id ?? newId('rel'),
      fromId: input.fromId,
      toId: input.toId,
      kind: input.kind,
      note: input.note.trim(),
      provenance: input.provenance ?? existing?.provenance ?? 'editor',
      ...stamp(
        input.status ??
          (existing
            ? statusOf(existing)
            : statusOf(index.topicsById.get(input.fromId)!) === 'published' &&
                statusOf(index.topicsById.get(input.toId)!) === 'published'
              ? 'published'
              : 'draft'),
        existing,
      ),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: by,
    };
    await this.store.putRelation(relation);
    this.invalidate();
    return relation;
  }

  async deleteRelation(relationId: string): Promise<void> {
    const index = await this.index(true);
    if (!index.snapshot.relations.some((r) => r.id === relationId)) {
      throw new NotFoundException(`No relation "${relationId}"`);
    }
    await this.store.deleteRelation(relationId);
    this.invalidate();
  }

  // Publishing --------------------------------------------------------------

  /** Sets the status of any mix of items. Unknown ids fail the whole call before anything is written. */
  async setStatus(input: SetStatusDto, by: string): Promise<{ updated: number }> {
    const { snapshot } = await this.index(true);
    const find = {
      topic: (id: string) => snapshot.topics.find((t) => t.id === id),
      reference: (id: string) => snapshot.references.find((r) => r.id === id),
      perspective: (id: string) => snapshot.perspectives.find((p) => p.id === id),
      relation: (id: string) => snapshot.relations.find((r) => r.id === id),
    };
    const targets = input.items.map((item) => {
      const found = find[item.type](item.id);
      if (!found) throw new NotFoundException(`No ${item.type} "${item.id}"`);
      return { type: item.type, found };
    });
    const now = new Date().toISOString();
    let updated = 0;
    for (const { type, found } of targets) {
      if (statusOf(found) === input.status) continue;
      const next = { ...found, ...stamp(input.status, found), updatedAt: now, updatedBy: by };
      if (type === 'topic') await this.store.putTopic(next as Topic);
      else if (type === 'reference') await this.store.putReference(next as Reference);
      else if (type === 'perspective') await this.store.putPerspective(next as Perspective);
      else await this.store.putRelation(next as Relation);
      updated++;
    }
    this.invalidate();
    return { updated };
  }

  /**
   * Publishes a topic and, by default, every draft that hangs off it: its
   * references and perspectives, and links whose other end is already published.
   */
  async publishTopic(topicId: string, includeChildren: boolean, by: string): Promise<TopicView> {
    const view = await this.view(topicId, true);
    const index = await this.index(true);
    const items: SetStatusDto['items'] = [{ type: 'topic', id: topicId }];
    if (includeChildren) {
      for (const r of view.references) if (statusOf(r) === 'draft') items.push({ type: 'reference', id: r.id });
      for (const p of view.perspectives) if (statusOf(p) === 'draft') items.push({ type: 'perspective', id: p.id });
      for (const { relation, other } of view.related) {
        const otherTopic = index.topicsById.get(other.id);
        if (statusOf(relation) === 'draft' && otherTopic && statusOf(otherTopic) === 'published') {
          items.push({ type: 'relation', id: relation.id });
        }
      }
    }
    await this.setStatus({ status: 'published', items }, by);
    return this.view(topicId, true);
  }


  // Pages -------------------------------------------------------------------

  private async findPage(id: PageId, fresh = false): Promise<Page | undefined> {
    return (await this.index(fresh)).snapshot.pages?.find((p) => p.id === id);
  }

  /** The live page for readers, or the editor's working copy in preview. */
  async page(id: PageId, preview: boolean): Promise<PageView> {
    return preview ? workingPage(id, await this.findPage(id, true)) : publicPage(id, await this.findPage(id));
  }

  /** Saves the working copy; the live page is unchanged until publishPage. */
  async savePage(id: PageId, input: PageInputDto, by: string): Promise<PageView> {
    const current = await this.findPage(id, true);
    const page: Page = {
      id,
      draft: { title: input.title.trim(), body: input.body.trim(), updatedAt: new Date().toISOString(), updatedBy: by },
      published: current?.published,
    };
    await this.store.putPage(page);
    this.invalidate();
    return workingPage(id, page);
  }

  /** Publishes the working copy (the default copy, if the page was never edited). */
  async publishPage(id: PageId, by: string): Promise<PageView> {
    const now = new Date().toISOString();
    const current = (await this.findPage(id, true)) ?? {
      id,
      draft: { ...workingPage(id, undefined), updatedAt: now, updatedBy: by },
    };
    const page: Page = {
      id,
      draft: current.draft,
      published: { title: current.draft.title, body: current.draft.body, publishedAt: now, publishedBy: by },
    };
    await this.store.putPage(page);
    this.invalidate();
    return workingPage(id, page);
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
