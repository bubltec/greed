import { ENTITY_DEFS, type Reference } from '@greed/domain';
import { ReferenceInputDto } from '../content.dto.js';
import { defineEntity, type Effect } from '../entity.js';
import { compactTopicView } from './compact.js';

export const referenceSpec = defineEntity<Reference, ReferenceInputDto>({
  def: ENTITY_DEFS.reference,
  dto: ReferenceInputDto,
  route: 'references',

  fields: (input) => ({
    label: input.label.trim(),
    url: input.url?.trim() || undefined,
    publishedOn: input.publishedOn || undefined,
    excerpt: input.excerpt?.trim() || undefined,
    note: input.note?.trim() || undefined,
  }),

  /** Deleting a source unlinks it from the points and perspectives that cited it. */
  onDelete: (reference, { index, by, now }) => {
    const topic = index.topicsById.get(reference.topicId);
    const view = index.view(reference.topicId);
    if (!topic || !view) return [];
    const drop = (ids: string[]) => ids.filter((id) => id !== reference.id);
    const effects: Effect[] = [];
    if (topic.sections.some((s) => s.points.some((p) => p.refIds.includes(reference.id)))) {
      effects.push({
        put: {
          entity: 'topic',
          item: {
            ...topic,
            sections: topic.sections.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, refIds: drop(p.refIds) })) })),
            updatedAt: now,
            updatedBy: by,
          },
        },
      });
    }
    for (const p of view.perspectives) {
      if (p.refIds.includes(reference.id)) {
        effects.push({ put: { entity: 'perspective', item: { ...p, refIds: drop(p.refIds), updatedAt: now, updatedBy: by } } });
      }
    }
    return effects;
  },

  present: (reference, { index }) => index.view(reference.topicId),

  mcp: {
    create: {
      name: 'add_reference',
      description:
        'Attach a source to a topic, as a draft. Returns the topic with the new reference’s id. Prefer primary sources and give the URL whenever one exists.',
    },
    update: {
      description: 'Fix or complete a reference, e.g. add the missing URL. Only the fields you pass change.',
    },
    deleteDraft: true,
    fields: {
      label: 'Publication or document, e.g. "Washington Post" or "DOJ press release".',
      url: 'https URL.',
      publishedOn: 'YYYY, YYYY-MM or YYYY-MM-DD.',
      excerpt: 'A short quote from the source supporting the claim.',
      note: 'e.g. "paywalled", "archived copy".',
    },
    result: (view, item) => ({ ...compactTopicView(view), added: item }),
  },
});
