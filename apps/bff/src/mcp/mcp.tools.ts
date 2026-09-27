import { RELATION_KINDS, RELATION_PROVENANCES, STANCES, TOPIC_KINDS } from '@greed/domain';

/** JSON Schemas for the MCP tools. Descriptions are written for the model that calls them. */
export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

const str = (description: string) => ({ type: 'string', description });
const refIds = {
  type: 'array',
  items: { type: 'string' },
  description: 'Ids of this topic’s references (from add_reference or get_topic) that support the text.',
};
const points = {
  type: 'array',
  description: 'Factual points, one claim each, in order.',
  items: {
    type: 'object',
    properties: { text: str('One factual point, plain text.'), refIds },
    required: ['text'],
  },
};
const sections = {
  type: 'array',
  description: 'Replaces ALL sections when given. To append, use add_points instead.',
  items: {
    type: 'object',
    properties: { label: str('Section heading, e.g. "What happened (Sept. 2026)".'), points },
    required: ['label', 'points'],
  },
};
const topicFields = {
  kind: { type: 'string', enum: TOPIC_KINDS, description: 'case (default), person, organization, synthesis, or thesis.' },
  title: str('Specific, neutral title.'),
  summary: str('Two or three sentences a reader can trust without clicking anything.'),
  disputed: str('What is contested or unproven: denials, anonymous sourcing, gaps. Empty if nothing.'),
  notes: str('Research notes and open leads. Shown publicly.'),
  tags: { type: 'array', items: { type: 'string' }, description: 'Lowercase tags, e.g. ["oil", "pardons"].' },
};

export const TOOLS: ToolDefinition[] = [
  {
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
  {
    name: 'get_topic',
    title: 'Get topic',
    description: 'Full topic: summary, sections with cited points, disputed notes, references (with ids), perspectives, and linked topics.',
    inputSchema: { type: 'object', properties: { id: str('Topic id (slug).') }, required: ['id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'find_gaps',
    title: 'Find gaps',
    description:
      'The editors’ worklist: sources missing URLs, topics with no perspectives, topics with no links, and topics with no sources. Use it to pick what to research next.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_topic',
    title: 'Create topic',
    description:
      'Create a new topic. Add its references next with add_reference, then cite them from points with add_points or update_topic. ' +
      'Every factual point should end up citing at least one reference.',
    inputSchema: {
      type: 'object',
      properties: { ...topicFields, sections },
      required: ['title', 'summary'],
    },
    annotations: {},
  },
  {
    name: 'update_topic',
    title: 'Update topic',
    description: 'Change a topic’s fields. Only the fields you pass change; `sections`, if passed, replaces all sections.',
    inputSchema: {
      type: 'object',
      properties: { id: str('Topic id.'), ...topicFields, sections },
      required: ['id'],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: 'add_points',
    title: 'Add points',
    description: 'Append points to a section of a topic, creating the section if no section has that label.',
    inputSchema: {
      type: 'object',
      properties: { topicId: str('Topic id.'), sectionLabel: str('Section heading to append to (exact match) or create.'), points },
      required: ['topicId', 'sectionLabel', 'points'],
    },
    annotations: {},
  },
  {
    name: 'add_reference',
    title: 'Add reference',
    description:
      'Attach a source to a topic. Returns the topic with the new reference’s id. Prefer primary sources and give the URL whenever one exists.',
    inputSchema: {
      type: 'object',
      properties: {
        topicId: str('Topic id.'),
        label: str('Publication or document, e.g. "Washington Post" or "DOJ press release".'),
        url: str('https URL.'),
        publishedOn: str('YYYY, YYYY-MM or YYYY-MM-DD.'),
        excerpt: str('A short quote from the source supporting the claim.'),
        note: str('e.g. "paywalled", "archived copy".'),
      },
      required: ['topicId', 'label'],
    },
    annotations: {},
  },
  {
    name: 'update_reference',
    title: 'Update reference',
    description: 'Fix or complete a reference, e.g. add the missing URL. Pass all fields you want to keep.',
    inputSchema: {
      type: 'object',
      properties: {
        topicId: str('Topic id.'),
        referenceId: str('Reference id.'),
        label: str('Publication or document.'),
        url: str('https URL.'),
        publishedOn: str('YYYY, YYYY-MM or YYYY-MM-DD.'),
        excerpt: str('Short supporting quote.'),
        note: str('Note.'),
      },
      required: ['topicId', 'referenceId', 'label'],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: 'add_perspective',
    title: 'Add perspective',
    description:
      'Add an attributed view on a topic, stated the way its holder would state it. Use `defender` or `official` for the accused side’s best case, not only critics.',
    inputSchema: {
      type: 'object',
      properties: {
        topicId: str('Topic id.'),
        stance: { type: 'string', enum: STANCES },
        holder: str('Who holds the view, e.g. "Pentagon spokesperson", "ACLU".'),
        body: str('The view.'),
        refIds,
      },
      required: ['topicId', 'stance', 'holder', 'body'],
    },
    annotations: {},
  },
  {
    name: 'link_topics',
    title: 'Link topics',
    description:
      'Link two topics. Kinds: same-actor, same-context, shared-mechanism, cause-effect (from is the cause), contradicts, related. ' +
      'Provenance: "sourced" if a source states the connection, else "inferred".',
    inputSchema: {
      type: 'object',
      properties: {
        fromId: str('Topic id.'),
        toId: str('Topic id.'),
        kind: { type: 'string', enum: RELATION_KINDS },
        note: str('One sentence on how they connect.'),
        provenance: { type: 'string', enum: RELATION_PROVENANCES },
      },
      required: ['fromId', 'toId', 'kind', 'note'],
    },
    annotations: {},
  },
  {
    name: 'unlink_topics',
    title: 'Unlink topics',
    description: 'Remove one link by its relation id (from get_topic’s `related[].relation.id`).',
    inputSchema: { type: 'object', properties: { relationId: str('Relation id.') }, required: ['relationId'] },
    annotations: { destructiveHint: true, idempotentHint: true },
  },
];
