import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryContentStore } from '@greed/domain';
import { ContentService } from '../content/content.service.js';
import { dto, pick, requireString } from './args.js';
import { dtoKeys, dtoSchema } from './dto-schema.js';
import { McpService } from './mcp.service.js';
import { TopicInputDto } from '../content/content.dto.js';

/** The tools called directly (no HTTP), covering the options the end-to-end test doesn't. */
let content: ContentService;
let mcp: McpService;
const run = (name: string, args: Record<string, unknown> = {}) => mcp.call(name, args, 'tester (mcp)') as Promise<any>;

beforeEach(() => {
  content = new ContentService(new InMemoryContentStore());
  mcp = new McpService(content);
});

const topic = (title: string, extra: Record<string, unknown> = {}) => run('create_topic', { title, summary: `${title} summary`, ...extra });

describe('search_topics and find_gaps', () => {
  it('filters by words and kind, caps the limit, and truncates summaries', async () => {
    await topic('Oil money', { tags: ['oil'], summary: 'x'.repeat(500) });
    await topic('Coal orders', { kind: 'organization' });
    await topic('Oil lobby', { kind: 'person', tags: ['Oil'] });
    expect((await run('search_topics')).total).toBe(3);
    expect((await run('search_topics', { query: 'oil' })).total).toBe(2);
    expect((await run('search_topics', { query: 'oil', kind: 'person' })).topics.map((t: { title: string }) => t.title)).toEqual(['Oil lobby']);
    const limited = await run('search_topics', { query: 'oil', limit: 1 });
    expect(limited).toMatchObject({ total: 2 });
    expect(limited.topics).toHaveLength(1);
    expect(limited.topics[0].summary.length).toBeLessThanOrEqual(300);
    expect((await run('search_topics', { limit: 'lots' })).topics).toHaveLength(3); // junk limit falls back to the default
    expect((await run('search_topics', { limit: 0 })).topics).toHaveLength(3);
  });

  it('lists what still needs work, exempting theses from needing sources', async () => {
    const a = await topic('Alpha');
    await topic('Thesis', { kind: 'thesis' });
    await run('add_reference', { topicId: a.id, label: 'NPR' });
    const gaps = await run('find_gaps');
    expect(gaps.sourcesMissingUrl).toEqual([{ topicId: a.id, referenceId: expect.any(String), label: 'NPR' }]);
    expect(gaps.topicsWithoutSources).toEqual([]);
    expect(gaps.topicsWithoutPerspectives.map((t: { id: string }) => t.id)).toEqual([a.id, 'thesis']);
    expect(gaps.topicsWithoutLinks).toHaveLength(2);
    expect(gaps.draftsAwaitingReview).toBe(3);
  });
});

describe('add_points', () => {
  it('appends to an existing section or creates one, keeping the topic’s other fields', async () => {
    const a = await topic('Alpha', { tags: ['x'] });
    const ref = (await run('add_reference', { topicId: a.id, label: 'NPR' })).added.id;
    await run('add_points', { topicId: a.id, sectionLabel: 'Facts', points: [{ text: 'One.', refIds: [ref] }] });
    const second = await run('add_points', { topicId: a.id, sectionLabel: 'Facts', points: [{ text: 'Two.' }] });
    expect(second.sections).toEqual([{ label: 'Facts', points: 2 }]);
    const other = await run('add_points', { topicId: a.id, sectionLabel: 'Context', points: [{ text: 'Three.' }] });
    expect(other.sections).toEqual([{ label: 'Facts', points: 2 }, { label: 'Context', points: 1 }]);
    const full = await run('get_topic', { id: a.id });
    expect(full.topic).toMatchObject({ tags: ['x'], status: 'draft' });
    expect(full.topic.sections[0].points[0].refIds).toEqual([ref]);
    expect(full.topic.sections[0].points[1].refIds).toEqual([]);
  });

  it('refuses an empty or missing points list', async () => {
    const a = await topic('Alpha');
    await expect(run('add_points', { topicId: a.id, sectionLabel: 'S', points: [] })).rejects.toThrow(/must not be empty/);
    await expect(run('add_points', { topicId: a.id, sectionLabel: 'S' })).rejects.toThrow(/must not be empty/);
    await expect(run('add_points', { topicId: 'nope', sectionLabel: 'S', points: [{ text: 'x' }] })).rejects.toThrow(/No topic/);
  });
});

describe('generated tools', () => {
  it('updates only the fields passed, and refuses invalid values with the field named', async () => {
    const a = await topic('Alpha', { tags: ['keep'] });
    await run('update_topic', { id: a.id, summary: 'New summary' });
    expect((await run('get_topic', { id: a.id })).topic).toMatchObject({ summary: 'New summary', title: 'Alpha', tags: ['keep'] });
    await expect(run('update_topic', { id: a.id, title: 'x' })).rejects.toThrow(/title/);
    await expect(run('create_topic', { title: 'Valid title', summary: 's', sections: [{ label: '', points: [] }] })).rejects.toThrow(/sections\.0\.label/);
    // Arguments the tool doesn't declare are ignored, not stored.
    const created = await run('create_topic', { title: 'Valid title', summary: 's', unknownField: 1, status: 'published' });
    expect(created).toMatchObject({ id: 'valid-title', status: 'draft' });
  });

  it('updates and deletes references and perspectives through their own tools', async () => {
    const a = await topic('Alpha');
    const ref = (await run('add_reference', { topicId: a.id, label: 'NPR' })).added;
    const updated = await run('update_reference', { topicId: a.id, referenceId: ref.id, url: 'https://npr.org/x' });
    expect(updated.references[0]).toMatchObject({ label: 'NPR', url: 'https://npr.org/x' });
    await expect(run('update_reference', { topicId: 'other', referenceId: ref.id, label: 'X' })).rejects.toThrow(/No topic/);
    await expect(run('update_reference', { topicId: a.id, label: 'X' })).rejects.toThrow(/referenceId is required/);
    await expect(run('update_reference', { topicId: a.id, referenceId: 'nope' })).rejects.toThrow(/No reference/);
    const withPerspective = await run('add_perspective', { topicId: a.id, stance: 'official', holder: 'EPA', body: 'Fine.', refIds: [ref.id] });
    const pid = withPerspective.perspectives[0].id;
    await expect(run('add_perspective', { topicId: a.id, stance: 'official', holder: 'EPA', body: 'x', refIds: ['ref_other'] })).rejects.toThrow(/not on this topic/);
    expect((await run('delete_draft', { type: 'perspective', id: pid }))).toEqual({ deleted: pid, type: 'perspective' });
    expect((await run('delete_draft', { type: 'reference', id: ref.id }))).toEqual({ deleted: ref.id, type: 'reference' });
    await expect(run('delete_draft', { type: 'page', id: 'home' })).rejects.toThrow(/type must be one of/);
    await expect(run('delete_draft', { id: 'x' })).rejects.toThrow(/type must be one of/);
    await expect(run('delete_draft', { type: 'topic' })).rejects.toThrow(/id is required/);
  });

  it('links, lists and unlinks topics, in any state', async () => {
    const a = await topic('Alpha');
    const b = await topic('Beta');
    const link = await run('link_topics', { fromId: a.id, toId: b.id, kind: 'related', note: 'n', provenance: 'sourced' });
    expect(link).toMatchObject({ provenance: 'sourced', status: 'draft' });
    await run('set_status', { status: 'published', items: [{ type: 'topic', id: a.id }, { type: 'topic', id: b.id }, { type: 'relation', id: link.id }] });
    expect((await run('list_drafts')).drafts).toEqual([]);
    await expect(run('delete_draft', { type: 'relation', id: link.id })).rejects.toThrow(/published/);
    expect(await run('unlink_topics', { relationId: link.id })).toEqual({ deleted: link.id });
    await expect(run('unlink_topics', { relationId: link.id })).rejects.toThrow(/No relation/);
    await expect(run('set_status', { status: 'published', items: [] })).rejects.toThrow(/items/);
  });

  it('publishes a topic with or without its drafts, and edits site pages', async () => {
    const a = await topic('Alpha');
    await run('add_reference', { topicId: a.id, label: 'NPR' });
    const alone = await run('publish_topic', { topicId: a.id, includeChildren: false });
    expect(alone).toMatchObject({ status: 'published', references: [{ status: 'draft' }] });
    expect((await run('publish_topic', { topicId: a.id })).references[0].status).toBe('published');
    await expect(run('publish_topic', {})).rejects.toThrow(/topicId is required/);

    expect(await run('get_page', { id: 'about' })).toMatchObject({ state: 'default' });
    const edited = await run('update_page', { id: 'about', title: 'About us' });
    expect(edited).toMatchObject({ title: 'About us', state: 'unpublished' });
    expect(edited.body).toContain('GREED documents'); // body kept from the default copy
    await run('update_page', { id: 'about', body: 'Short.' });
    expect(await run('publish_page', { id: 'about' })).toMatchObject({ title: 'About us', body: 'Short.', state: 'published' });
    await expect(run('get_page', { id: 'nope' })).rejects.toThrow(/No page/);
    await expect(run('get_page', {})).rejects.toThrow(/id is required/);
    await expect(run('create_page', { title: 'x', body: 'y' })).rejects.toThrow(/Unknown tool/);
  });

  it('publishes a never-edited page from its default copy', async () => {
    expect(await run('publish_page', { id: 'home' })).toMatchObject({ state: 'published' });
  });

  it('describes every tool with a name, schema and annotations', () => {
    for (const tool of mcp.listTools()) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
    }
  });
});

describe('argument helpers and schema generation', () => {
  it('picks present keys, and requires non-empty strings', () => {
    expect(pick({ a: 1, b: undefined, c: null }, ['a', 'b', 'c', 'd'])).toEqual({ a: 1, c: null });
    expect(requireString({ k: 'v' }, 'k')).toBe('v');
    for (const bad of [{}, { k: '' }, { k: 3 }]) expect(() => requireString(bad, 'k')).toThrow(/k is required/);
  });

  it('validates with the DTO and names nested fields in errors', async () => {
    await expect(dto(TopicInputDto, { title: 'ok title', summary: 's', kind: 'case', sections: [{ label: 'L', points: [{ text: 1 }] }], disputed: '', notes: '', tags: [] })).rejects.toThrow(/sections\.0\.points\.0\.text|points/);
    expect((await dto(TopicInputDto, { title: 'ok title', summary: 's', kind: 'case', sections: [], disputed: '', notes: '', tags: [], status: undefined })).title).toBe('ok title');
  });

  it('reads the DTO into a schema: nested items, enums, bounds, optional fields, omissions and partials', () => {
    const full = dtoSchema(TopicInputDto, { omit: ['id', 'status'], defaults: ['kind'], docs: { 'sections.label': 'Heading' } }) as any;
    expect(full.required).toEqual(['title', 'summary', 'sections', 'disputed', 'notes', 'tags']);
    expect(full.properties.id).toBeUndefined();
    expect(full.properties.tags).toMatchObject({ type: 'array', maxItems: 20, items: { type: 'string', maxLength: 40 } });
    expect(full.properties.sections.items.properties.label).toMatchObject({ minLength: 1, maxLength: 200, description: 'Heading' });
    expect(full.properties.sections.items.required).toEqual(['label', 'points']);
    expect(full.properties.sections.maxItems).toBe(50);
    const partial = dtoSchema(TopicInputDto, { partial: true }) as any;
    expect(partial.required).toBeUndefined();
    expect(partial.properties.id.pattern).toContain('a-z0-9');
    expect(dtoKeys(TopicInputDto)).toEqual(expect.arrayContaining(['id', 'kind', 'status']));
  });
});
