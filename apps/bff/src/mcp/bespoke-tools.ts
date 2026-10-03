import { type Section, STATUSES, TOPIC_KINDS, type Topic } from '@greed/domain';
import { BadRequestException } from '@nestjs/common';
import type { ContentService } from '../content/content.service.js';
import { SetStatusDto, TopicInputDto } from '../content/content.dto.js';
import { compactTopicView } from '../content/entities/compact.js';
import { ENTITIES } from '../content/entities/index.js';
import { ITEM_TYPES } from '../content/content.dto.js';
import { type Args, dto, pick, requireString } from './args.js';
import { currentInput } from './crud-tools.js';
import type { Tool } from './tool.js';

const str = (description: string) => ({ type: 'string', description });

/**
 * The tools that aren't create/read/update/delete of one entity: searching,
 * the editors' worklist, appending points, and the review queue.
 */
export function bespokeTools(content: ContentService): Tool[] {
  return [
    {
      definition: {
        name: 'search_topics',
        title: 'Search topics',
        description:
          'Search GREED’s topics (documented cases, people, organizations, syntheses) by words in the title, summary or tags. ' +
          'Returns summaries with counts of sources, perspectives and links. Call this before creating a topic to avoid duplicates.',
        inputSchema: {
          type: 'object',
          properties: {
            query: str('Words to match; omit to list everything.'),
            kind: { type: 'string', enum: TOPIC_KINDS },
            limit: { type: 'number', description: 'Default 25, max 100.' },
          },
        },
        annotations: { readOnlyHint: true },
      },
      run: async (args) => search(content, args),
    },
    {
      definition: {
        name: 'find_gaps',
        title: 'Find gaps',
        description:
          'The editors’ worklist: sources missing URLs, topics with no perspectives, topics with no links, and topics with no sources. Use it to pick what to research next.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
      },
      run: async () => gaps(content),
    },
    {
      definition: {
        name: 'add_points',
        title: 'Add points',
        description: 'Append points to a section of a topic, creating the section if no section has that label.',
        inputSchema: {
          type: 'object',
          properties: {
            topicId: str('Topic id.'),
            sectionLabel: str('Section heading to append to (exact match) or create.'),
            points: ENTITIES.topic.mcp!.fields ? pointsSchema(ENTITIES.topic.mcp!.fields) : {},
          },
          required: ['topicId', 'sectionLabel', 'points'],
        },
        annotations: {},
      },
      run: async (args, by) => {
        const topicId = requireString(args, 'topicId');
        const topic = (await content.find('topic', topicId)) as Topic;
        const label = requireString(args, 'sectionLabel');
        const added = (Array.isArray(args.points) ? args.points : []).map((p) => ({
          text: (p as Args).text as string,
          refIds: ((p as Args).refIds ?? []) as string[],
        }));
        if (added.length === 0) throw new BadRequestException('points must not be empty');
        const sections: Section[] = topic.sections.some((s) => s.label === label)
          ? topic.sections.map((s) => (s.label === label ? { ...s, points: [...s.points, ...added] } : s))
          : [...topic.sections, { id: undefined as never, label, points: added }];
        const input = await dto(TopicInputDto, { ...currentInput(ENTITIES.topic, topic), sections });
        return compactTopicView((await content.update('topic', { id: topicId }, input, by)).result as never);
      },
    },
    {
      definition: {
        name: 'list_drafts',
        title: 'List drafts',
        description:
          'Everything still in draft (topics, references, perspectives, links), newest first, with whether its topic is already live. This is the editor’s review queue.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
      },
      run: async () => ({ drafts: (await content.index(true)).drafts() }),
    },
    {
      definition: {
        name: 'set_status',
        title: 'Set status',
        description:
          'Publish or unpublish specific items (e.g. one new reference on a live topic), or return something to draft. Only publish when the user asks.',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: STATUSES },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ITEM_TYPES },
                  id: str('Item id (relation ids come from get_topic’s related[].relation.id).'),
                },
                required: ['type', 'id'],
              },
            },
          },
          required: ['status', 'items'],
        },
        annotations: { idempotentHint: true },
      },
      run: async (args, by) => content.setStatus(await dto(SetStatusDto, pick(args, ['status', 'items'])), by),
    },
  ];
}

/** The `points` argument, shaped like a section's points in the topic schema. */
function pointsSchema(docs: Record<string, string>) {
  return {
    type: 'array',
    description: docs['sections.points'],
    items: {
      type: 'object',
      properties: {
        text: str(docs['sections.points.text']!),
        refIds: { type: 'array', items: { type: 'string' }, description: docs['sections.points.refIds'] },
      },
      required: ['text'],
    },
  };
}

async function search(content: ContentService, args: Args) {
  const words = (typeof args.query === 'string' ? args.query : '').toLowerCase().split(/\s+/).filter(Boolean);
  const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
  const all = (await content.index(true)).summaries();
  const hits = all.filter((t) => {
    if (typeof args.kind === 'string' && t.kind !== args.kind) return false;
    const hay = `${t.id} ${t.title} ${t.summary} ${t.tags.join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return { total: hits.length, topics: hits.slice(0, limit).map(({ summary, ...rest }) => ({ ...rest, summary: summary.slice(0, 300) })) };
}

async function gaps(content: ContentService) {
  const index = await content.index(true);
  const { snapshot } = index;
  const title = new Map(snapshot.topics.map((t) => [t.id, t.title]));
  const linked = new Set(snapshot.relations.flatMap((r) => [r.fromId, r.toId]));
  const withPerspective = new Set(snapshot.perspectives.map((p) => p.topicId));
  const withRefs = new Set(snapshot.references.map((r) => r.topicId));
  const topic = (id: string) => ({ id, title: title.get(id) ?? id });
  return {
    draftsAwaitingReview: index.drafts().length,
    sourcesMissingUrl: snapshot.references.filter((r) => !r.url).map((r) => ({ topicId: r.topicId, referenceId: r.id, label: r.label })),
    topicsWithoutPerspectives: snapshot.topics.filter((t) => !withPerspective.has(t.id)).map((t) => topic(t.id)),
    topicsWithoutLinks: snapshot.topics.filter((t) => !linked.has(t.id)).map((t) => topic(t.id)),
    topicsWithoutSources: snapshot.topics.filter((t) => !withRefs.has(t.id) && t.kind !== 'thesis').map((t) => topic(t.id)),
  };
}
