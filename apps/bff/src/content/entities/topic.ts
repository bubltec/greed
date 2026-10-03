import { BadRequestException } from '@nestjs/common';
import { ENTITY_DEFS, newId, type Section, statusOf, type Topic, uniqueSlug } from '@greed/domain';
import { TopicInputDto } from '../content.dto.js';
import { defineEntity } from '../entity.js';
import { compactTopicView } from './compact.js';

export const topicSpec = defineEntity<Topic, TopicInputDto>({
  def: ENTITY_DEFS.topic,
  dto: TopicInputDto,
  route: 'topics',

  makeId: (input, { index }) => {
    const taken = new Set(index.topicsById.keys());
    const id = input.id ? input.id : uniqueSlug(input.title, taken);
    if (taken.has(id)) throw new BadRequestException(`Topic id "${id}" already exists`);
    return id;
  },
  defaultStatus: () => 'draft',

  fields: (input, { index, existing }) => {
    // On create there are no refs yet; on update, drop ids that aren't this topic's.
    const validRefIds = new Set(existing ? (index.view(existing.id)?.references ?? []).map((r) => r.id) : []);
    const sections: Section[] = input.sections.map((s) => ({
      id: s.id || newId('sec'),
      label: s.label.trim(),
      points: s.points
        .filter((p) => p.text.trim())
        .map((p) => ({ text: p.text.trim(), refIds: p.refIds.filter((r) => validRefIds.has(r)) })),
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
  },

  // Children (references, perspectives) cascade automatically; links reference topics by id, so they are ours to remove.
  onDelete: (topic, { index }) =>
    index.snapshot.relations
      .filter((r) => r.fromId === topic.id || r.toId === topic.id)
      .map((r) => ({ remove: { entity: 'relation' as const, ref: { id: r.id } } })),

  present: (topic, { index }) => index.view(topic.id),

  /**
   * Publishing a topic can take its drafts with it: references and perspectives,
   * and links whose other end is already published.
   */
  publish: {
    cascade: (topic, { index }, includeChildren) => {
      if (!includeChildren) return [];
      const view = index.view(topic.id)!;
      const items: { type: 'reference' | 'perspective' | 'relation'; id: string }[] = [];
      for (const r of view.references) if (statusOf(r) === 'draft') items.push({ type: 'reference', id: r.id });
      for (const p of view.perspectives) if (statusOf(p) === 'draft') items.push({ type: 'perspective', id: p.id });
      for (const { relation, other } of view.related) {
        const otherTopic = index.topicsById.get(other.id);
        if (statusOf(relation) === 'draft' && otherTopic && statusOf(otherTopic) === 'published') {
          items.push({ type: 'relation', id: relation.id });
        }
      }
      return items;
    },
  },

  mcp: {
    get: {
      idArg: 'id',
      description:
        'Full topic including drafts: summary, sections with cited points, the closing note, references (with ids), perspectives, linked topics, and each item’s status.',
    },
    create: {
      description:
        'Create a new topic, as a draft. Add its references next with add_reference, then cite them from points with add_points or update_topic. ' +
        'Every factual point should end up citing at least one reference. Nothing is public until published with publish_topic.',
      defaults: { kind: 'case', sections: [], disputed: '', notes: '', tags: [] },
    },
    update: {
      idArg: 'id',
      description: 'Change a topic’s fields. Only the fields you pass change; `sections`, if passed, replaces all sections.',
    },
    publish: {
      idArg: 'topicId',
      description:
        'Make a topic public, by default together with its draft references, perspectives, and links to already-published topics. ' +
        'Only call this when the user explicitly asks to publish; otherwise leave work as drafts for them to review.',
    },
    deleteDraft: true,
    omit: ['id'],
    fields: {
      kind: 'case (default), person, organization, synthesis, or thesis.',
      title: 'Specific, neutral title.',
      summary: 'Two or three sentences a reader can trust without clicking anything.',
      disputed:
        'One short sentence noting the main denial or open question, if any (shown small at the end of the entry). Empty if nothing.',
      notes: 'Research notes and open leads. Shown publicly.',
      tags: 'Lowercase tags, e.g. ["oil", "pardons"].',
      sections: 'Replaces ALL sections when given. To append, use add_points instead.',
      'sections.label': 'Section heading, e.g. "What happened (Sept. 2026)".',
      'sections.points': 'Factual points, one claim each, in order.',
      'sections.points.text': 'One factual point, plain text.',
      'sections.points.refIds': 'Ids of this topic’s references (from add_reference or get_topic) that support the text.',
    },
    result: compactTopicView,
  },
});
