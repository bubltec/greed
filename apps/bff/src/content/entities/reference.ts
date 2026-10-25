import { BadRequestException } from '@nestjs/common';
import { ENTITY_DEFS, type Reference } from '@greed/domain';
import { ReferenceInputDto } from '../content.dto.js';
import { defineEntity, type Effect } from '../entity.js';
import { compactTopicView } from './compact.js';

export const referenceSpec = defineEntity<Reference, ReferenceInputDto>({
  def: ENTITY_DEFS.reference,
  dto: ReferenceInputDto,
  route: 'references',

  fields: (input, { index, existing }) => {
    const verdict = input.verdict?.trim() || undefined;
    const viralClaim = input.viralClaim === true;
    if (viralClaim && !verdict) throw new BadRequestException('A viral claim needs a verdict: one line on what the record shows');
    if (!viralClaim && verdict) throw new BadRequestException('A verdict only goes with a viral claim; set viralClaim too');
    // Viral claims are cited and answered, never embedded; evidence already attached means this is a real source.
    if (viralClaim && existing && (index.snapshot.attachments ?? []).some((a) => a.referenceId === existing.id)) {
      throw new BadRequestException('This reference has archived evidence attached, so it cannot be marked a viral claim');
    }
    return {
      label: input.label.trim(),
      url: input.url?.trim() || undefined,
      publishedOn: input.publishedOn || undefined,
      excerpt: input.excerpt?.trim() || undefined,
      note: input.note?.trim() || undefined,
      viralClaim: viralClaim || undefined,
      verdict,
    };
  },

  /** Deleting a source unlinks it from the points and perspectives that cited it, and drops its evidence rows. */
  onDelete: (reference, { index, by, now }) => {
    const topic = index.topicsById.get(reference.topicId);
    const view = index.view(reference.topicId);
    if (!topic || !view) return [];
    const drop = (ids: string[]) => ids.filter((id) => id !== reference.id);
    // The archived file stays: it is content-addressed, may back another row, and is evidence worth keeping.
    const effects: Effect[] = view.attachments
      .filter((a) => a.referenceId === reference.id)
      .map((a) => ({ remove: { entity: 'attachment' as const, ref: { id: a.id, parentId: a.topicId } } }));
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
      viralClaim: 'True for a circulating claim (a viral screenshot or post). It is cited and answered with a verdict, never embedded or attached.',
      verdict: 'Required with viralClaim: one line on what the record shows about the claim.',
    },
    result: (view, item) => ({ ...compactTopicView(view), added: item }),
  },
});
