import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import {
  type Collection,
  ENTITY_DEFS,
  ENTITY_LIST,
  type EntityDef,
  type EntityName,
  InMemoryContentStore,
  STATUSES,
  type Status,
  type Topic,
} from '@greed/domain';
import { crudTools } from '../mcp/crud-tools.js';
import { ContentService } from './content.service.js';
import { ENTITIES, ENTITY_SPECS } from './entities/index.js';
import { defineEntity } from './entity.js';

/**
 * Proves the claim in the architecture rule: a new content type is a def row, a DTO and a spec,
 * and nothing else (service, store, cascades, MCP tools) needs to change. The two types here
 * exist only in this file; they are registered at runtime and removed afterwards.
 */

class NoteInputDto {
  @IsString()
  @Length(1, 100)
  text!: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: Status;
}

interface Note {
  id: string;
  topicId: string;
  text: string;
  status?: Status;
  createdAt: string;
  updatedAt: string;
}

const noteDef: EntityDef = {
  name: 'note' as EntityName,
  collection: 'notes' as Collection,
  idPrefix: 'note',
  parent: 'topic',
  parentField: 'topicId',
  lifecycle: 'status',
  address: ({ id, parentId }) => ({ PK: `TOPIC#${parentId}`, SK: `NOTE#${id}` }),
  owns: (sk) => sk.startsWith('NOTE#'),
};

const memoDef: EntityDef = {
  name: 'memo' as EntityName,
  collection: 'memos' as Collection,
  idPrefix: 'memo',
  lifecycle: 'status',
  address: ({ id }) => ({ PK: `MEMO#${id}`, SK: 'MEMO' }),
  owns: (sk) => sk === 'MEMO',
};

// A child of a topic that opts in to MCP.
const noteSpec = defineEntity<Note, NoteInputDto>({
  def: noteDef,
  dto: NoteInputDto,
  route: 'notes',
  fields: (input) => ({ text: input.text.trim() }),
  present: (note, { index }) => index.view(note.topicId),
  mcp: { create: true, update: true, deleteDraft: true, fields: { text: 'The note.' } },
});

// A top-level type with no `mcp` block: it must get no tools.
const memoSpec = defineEntity<{ id: string; text: string }, NoteInputDto>({
  def: memoDef,
  dto: NoteInputDto,
  route: 'memos',
  fields: (input) => ({ text: input.text.trim() }),
});

const registry = ENTITIES as Record<string, unknown>;
const defs = ENTITY_DEFS as Record<string, EntityDef>;

beforeAll(() => {
  for (const [def, spec] of [[noteDef, noteSpec], [memoDef, memoSpec]] as const) {
    defs[def.name] = def;
    ENTITY_LIST.push(def);
    registry[def.name] = spec;
    ENTITY_SPECS.push(spec);
  }
});

afterAll(() => {
  for (const def of [noteDef, memoDef]) {
    delete defs[def.name];
    delete registry[def.name];
    ENTITY_LIST.splice(ENTITY_LIST.indexOf(def), 1);
    ENTITY_SPECS.splice(ENTITY_SPECS.findIndex((s) => s.def === def), 1);
  }
});

const at = '2026-01-01T00:00:00.000Z';
const topic: Topic = {
  id: 't',
  kind: 'case',
  title: 'T',
  summary: '',
  sections: [],
  disputed: '',
  notes: '',
  tags: [],
  createdAt: at,
  updatedAt: at,
  status: 'draft',
};

const setup = () => {
  const content = new ContentService(new InMemoryContentStore({ topics: [topic] }));
  return { content, tools: new Map(crudTools(content).map((t) => [t.definition.name, t])) };
};
const notes = async (content: ContentService) =>
  ((await content.index(true)).snapshot as unknown as { notes: Note[] }).notes;

describe('a content type added from scratch', () => {
  it('gets create, update, status inheritance and delete from the generic service', async () => {
    const { content } = setup();
    const { item } = await content.create('note' as EntityName, { text: ' first ' }, 'ed', 't');
    expect(item).toMatchObject({ topicId: 't', text: 'first', status: 'draft', updatedBy: 'ed' }); // the topic is a draft
    const created = item as Note;

    const updated = await content.update('note' as EntityName, { id: created.id, parentId: 't' }, { text: 'second' }, 'ed');
    expect(updated.item).toMatchObject({ id: created.id, text: 'second', createdAt: created.createdAt });
    expect((updated.result as { topic: Topic }).topic.id).toBe('t'); // `present` returned the parent's view

    await expect(content.update('note' as EntityName, { id: created.id, parentId: 'other' }, { text: 'x' }, 'ed')).rejects.toThrow(/No topic/);
    await content.setStatus({ status: 'published', items: [{ type: 'note' as EntityName, id: created.id }] }, 'ed');
    expect((await notes(content))[0]!.status).toBe('published');
    await expect(content.removeDraft('note' as EntityName, created.id, 'ed')).rejects.toThrow(/published/);
  });

  it('is deleted along with its parent topic, with no cascade code of its own', async () => {
    const { content } = setup();
    await content.create('note' as EntityName, { text: 'a' }, 'ed', 't');
    await content.create('note' as EntityName, { text: 'b' }, 'ed', 't');
    expect(await notes(content)).toHaveLength(2);
    await content.remove('topic', { id: 't' }, 'ed');
    expect(await notes(content)).toEqual([]);
  });

  it('gets MCP tools only because it opted in, with schemas generated from its DTO', async () => {
    const { content, tools } = setup();
    expect([...tools.keys()].filter((n) => n.endsWith('_note')).sort()).toEqual(['create_note', 'update_note']);
    expect(tools.get('create_note')!.definition.inputSchema).toMatchObject({
      required: ['topicId', 'text'],
      properties: { text: { type: 'string', minLength: 1, maxLength: 100, description: 'The note.' } },
    });
    expect((tools.get('create_note')!.definition.inputSchema as { properties: object }).properties).not.toHaveProperty('status');
    expect(tools.get('update_note')!.definition.inputSchema).toMatchObject({ required: ['topicId', 'noteId'] });
    expect(tools.get('delete_draft')!.definition.inputSchema).toMatchObject({
      properties: { type: { enum: expect.arrayContaining(['note']) } },
    });

    // Tool calls go through the same validation and always create drafts.
    await tools.get('create_note')!.run({ topicId: 't', text: 'via mcp' }, 'me (mcp)');
    const [note] = await notes(content);
    expect(note).toMatchObject({ text: 'via mcp', status: 'draft' });
    await expect(tools.get('create_note')!.run({ topicId: 't', text: '' }, 'me')).rejects.toThrow(/text/);
    await tools.get('update_note')!.run({ topicId: 't', noteId: note!.id, text: 'edited' }, 'me');
    expect((await notes(content))[0]!.text).toBe('edited');
    await tools.get('delete_draft')!.run({ type: 'note', id: note!.id }, 'me');
    expect(await notes(content)).toEqual([]);
  });

  it('has no tools at all when it does not opt in, but still works through the service', async () => {
    const { content, tools } = setup();
    expect([...tools.keys()].filter((n) => n.includes('memo'))).toEqual([]);
    expect(tools.get('delete_draft')!.definition.inputSchema).toMatchObject({
      properties: { type: { enum: expect.not.arrayContaining(['memo']) } },
    });
    const { item } = await content.create('memo' as EntityName, { text: 'hi' }, 'ed');
    expect(item).toMatchObject({ text: 'hi', status: 'draft' });
    await content.remove('memo' as EntityName, { id: item.id }, 'ed');
    expect(((await content.index(true)).snapshot as unknown as { memos: unknown[] }).memos).toEqual([]);
  });
});
