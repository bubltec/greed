import { BadRequestException } from '@nestjs/common';
import { ENTITY_DEFS, type Perspective } from '@greed/domain';
import { PerspectiveInputDto } from '../content.dto.js';
import { defineEntity } from '../entity.js';
import { compactTopicView } from './compact.js';

export const perspectiveSpec = defineEntity<Perspective, PerspectiveInputDto>({
  def: ENTITY_DEFS.perspective,
  dto: PerspectiveInputDto,
  route: 'perspectives',

  fields: (input, { index, parent }) => {
    const own = new Set((index.view(parent.id)?.references ?? []).map((r) => r.id));
    const unknown = input.refIds.filter((r) => !own.has(r));
    if (unknown.length) throw new BadRequestException(`References not on this topic: ${unknown.join(', ')}`);
    return {
      stance: input.stance,
      holder: input.holder.trim(),
      body: input.body.trim(),
      refIds: [...new Set(input.refIds)],
    };
  },

  present: (perspective, { index }) => index.view(perspective.topicId),

  mcp: {
    create: {
      name: 'add_perspective',
      description:
        'Add an attributed view on a topic (as a draft), stated the way its holder would state it. ' +
        'Use `defender` or `official` for the accused side’s best case, not only critics.',
      defaults: { refIds: [] },
    },
    update: {
      description:
        'Change a perspective, e.g. fix its stance or holder or reword its body. Only the fields you pass change; `refIds`, if passed, replaces all citations.',
    },
    deleteDraft: true,
    fields: {
      holder: 'Who holds the view, e.g. "Pentagon spokesperson", "ACLU".',
      body: 'The view.',
      refIds: 'Ids of this topic’s references (from add_reference or get_topic) that support the view.',
    },
    result: compactTopicView,
  },
});
