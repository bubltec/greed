import { BadRequestException } from '@nestjs/common';
import { ENTITY_DEFS, type Relation, statusOf } from '@greed/domain';
import { RelationInputDto } from '../content.dto.js';
import { defineEntity } from '../entity.js';

export const relationSpec = defineEntity<Relation, RelationInputDto>({
  def: ENTITY_DEFS.relation,
  dto: RelationInputDto,
  route: 'relations',

  fields: (input, { index, existing }) => {
    for (const id of [input.fromId, input.toId]) {
      if (!index.topicsById.has(id)) throw new BadRequestException(`No topic "${id}"`);
    }
    if (input.fromId === input.toId) throw new BadRequestException('A topic cannot relate to itself');
    const duplicate = index.snapshot.relations.find(
      (r) =>
        r.id !== existing?.id &&
        r.kind === input.kind &&
        ((r.fromId === input.fromId && r.toId === input.toId) || (r.fromId === input.toId && r.toId === input.fromId)),
    );
    if (duplicate) throw new BadRequestException('That relation already exists');
    return {
      fromId: input.fromId,
      toId: input.toId,
      kind: input.kind,
      note: input.note.trim(),
      provenance: input.provenance ?? existing?.provenance ?? 'editor',
    };
  },

  /** A link goes live with its topics: published only when both ends are. */
  defaultStatus: (input, { index }) =>
    statusOf(index.topicsById.get(input.fromId)!) === 'published' && statusOf(index.topicsById.get(input.toId)!) === 'published'
      ? 'published'
      : 'draft',

  mcp: {
    create: {
      name: 'link_topics',
      description:
        'Link two topics (as a draft). Kinds: same-actor, same-context, shared-mechanism, cause-effect (from is the cause), contradicts, related. ' +
        'Provenance: "sourced" if a source states the connection, else "inferred".',
      defaults: { provenance: 'inferred' },
    },
    delete: {
      name: 'unlink_topics',
      idArg: 'relationId',
      description: 'Remove one link by its relation id (from get_topic’s `related[].relation.id`).',
    },
    deleteDraft: true,
    fields: {
      fromId: 'Topic id.',
      toId: 'Topic id.',
      note: 'One sentence on how they connect.',
    },
  },
});
