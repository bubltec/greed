import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ContentIndex,
  type ContentStore,
  newId,
  type Perspective,
  type Reference,
  type Relation,
  type Section,
  type Topic,
  type TopicView,
  uniqueSlug,
} from '@greed/domain';
import { cacheTtlMs } from '../env.js';
import { CONTENT_STORE } from './content.tokens.js';
import type {
  PerspectiveInputDto,
  ReferenceInputDto,
  RelationInputDto,
  TopicInputDto,
} from './content.dto.js';

/**
 * All reads go through one cached ContentIndex; every write invalidates it.
 * Integrity rules (refs belong to their topic, no self or duplicate relations,
 * deleting a reference unlinks it everywhere) live here so every client gets
 * them, not just the web CMS.
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
    const topic: Topic = {
      id,
      ...this.topicFields(input, new Set()),
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
}
