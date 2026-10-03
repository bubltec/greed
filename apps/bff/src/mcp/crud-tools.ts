import { type EntityName } from '@greed/domain';
import type { ContentService } from '../content/content.service.js';
import { ENTITY_SPECS, ENTITIES } from '../content/entities/index.js';
import type { EntitySpec, McpOp } from '../content/entity.js';
import { type Args, dto, pick, requireString } from './args.js';
import { dtoKeys, dtoSchema } from './dto-schema.js';
import type { Tool } from './tool.js';

const str = (description: string) => ({ type: 'string', description });
const op = (cfg: McpOp | true | undefined): McpOp | undefined => (cfg === true ? {} : cfg);

/** Fields that never come from a tool call: the service owns identity and status. */
const NEVER = ['id', 'status'];

/** The item's current values as DTO input, so a partial update only changes what the caller passes. */
export function currentInput(spec: EntitySpec, item: { id: string }): Args {
  if (spec.toInput) return spec.toInput(item);
  const record = item as unknown as Args;
  return pick(record, dtoKeys(spec.dto).filter((k) => !NEVER.includes(k)));
}

/**
 * Tools generated from the entity registry: only for entities that opt in with
 * `mcp`, and only for the operations they list. Everything goes through
 * ContentService, so the CMS's validation and integrity rules apply unchanged.
 */
export function crudTools(content: ContentService): Tool[] {
  return [...ENTITY_SPECS.flatMap((spec) => (spec.mcp ? entityTools(content, spec) : [])), deleteDraftTool(content)].filter(
    (t): t is Tool => !!t,
  );
}

function entityTools(content: ContentService, spec: EntitySpec): Tool[] {
  const { def, mcp = {} } = spec;
  const name: EntityName = def.name;
  const parentArg = def.parent ? `${def.parent}Id` : undefined;
  const inputKeys = dtoKeys(spec.dto).filter((k) => !NEVER.includes(k) && !mcp.omit?.includes(k));
  const tools: Tool[] = [];

  const idSchema = (idArg: string, what: string) => ({
    [idArg]: spec.fixedIds ? { type: 'string', enum: [...spec.fixedIds.all()], description: `${what} id.` } : str(`${what} id.`),
  });
  const parentSchema = parentArg ? { [parentArg]: str(`${cap(def.parent!)} id.`) } : {};
  const finish = (presented: unknown, item?: unknown) => (mcp.result ? mcp.result(presented, item) : presented);

  const get = op(mcp.get);
  if (get) {
    const idArg = get.idArg ?? `${name}Id`;
    tools.push({
      definition: {
        name: get.name ?? `get_${name}`,
        title: get.title ?? `Get ${name}`,
        description: get.description ?? `Read one ${name}, drafts included.`,
        inputSchema: { type: 'object', properties: idSchema(idArg, cap(name)), required: [idArg] },
        annotations: { readOnlyHint: true },
      },
      run: (args, by) => content.get(name, requireString(args, idArg), by),
    });
  }

  const create = op(mcp.create);
  if (create && !spec.fixedIds) {
    const defaults = create.defaults ?? {};
    const schema = dtoSchema(spec.dto, { docs: mcp.fields, omit: [...NEVER, ...(mcp.omit ?? [])], defaults: Object.keys(defaults) }) as {
      properties: Args;
      required?: string[];
    };
    tools.push({
      definition: {
        name: create.name ?? `create_${name}`,
        title: create.title ?? `Create ${name}`,
        description: create.description ?? `Create a ${name}, as a draft.`,
        inputSchema: {
          type: 'object',
          properties: { ...parentSchema, ...schema.properties },
          required: [...(parentArg ? [parentArg] : []), ...(schema.required ?? [])],
        },
        annotations: {},
      },
      run: async (args, by) => {
        // Everything the connector creates is a draft.
        const input = await dto(spec.dto, { ...defaults, ...pick(args, inputKeys), ...(def.lifecycle === 'status' ? { status: 'draft' } : {}) });
        const { item, result } = await content.create(name, input, by, parentArg ? requireString(args, parentArg) : undefined);
        return finish(result, item);
      },
    });
  }

  const update = op(mcp.update);
  if (update) {
    const idArg = update.idArg ?? `${name}Id`;
    const schema = dtoSchema(spec.dto, { docs: mcp.fields, omit: [...NEVER, ...(mcp.omit ?? [])], partial: true }) as { properties: Args };
    tools.push({
      definition: {
        name: update.name ?? `update_${name}`,
        title: update.title ?? `Update ${name}`,
        description: update.description ?? `Change a ${name}. Only the fields you pass change.`,
        inputSchema: {
          type: 'object',
          properties: { ...parentSchema, ...idSchema(idArg, cap(name)), ...schema.properties },
          required: [...(parentArg ? [parentArg] : []), idArg],
        },
        annotations: { idempotentHint: true },
      },
      run: async (args, by) => {
        const id = requireString(args, idArg);
        const current = currentInput(spec, await content.find(name, id));
        const input = await dto(spec.dto, { ...current, ...pick(args, inputKeys) });
        const { item, result } = await content.update(name, { id, parentId: parentArg ? requireString(args, parentArg) : undefined }, input, by);
        return finish(result, item);
      },
    });
  }

  const del = op(mcp.delete);
  if (del && !spec.fixedIds) {
    const idArg = del.idArg ?? `${name}Id`;
    tools.push({
      definition: {
        name: del.name ?? `delete_${name}`,
        title: del.title ?? `Delete ${name}`,
        description: del.description ?? `Permanently delete a ${name}, whatever its status.`,
        inputSchema: { type: 'object', properties: idSchema(idArg, cap(name)), required: [idArg] },
        annotations: { destructiveHint: true, idempotentHint: true },
      },
      run: async (args, by) => {
        const id = requireString(args, idArg);
        await content.remove(name, { id }, by);
        return { deleted: id };
      },
    });
  }

  const publish = op(mcp.publish);
  if (publish && (spec.publish || spec.publishItem)) {
    const idArg = publish.idArg ?? `${name}Id`;
    tools.push({
      definition: {
        name: publish.name ?? `publish_${name}`,
        title: publish.title ?? `Publish ${name}`,
        description: publish.description ?? `Make a ${name} public. Only when the user explicitly asks.`,
        inputSchema: {
          type: 'object',
          properties: {
            ...idSchema(idArg, cap(name)),
            ...(spec.publish?.cascade ? { includeChildren: { type: 'boolean', description: 'Also publish its drafts (default true).' } } : {}),
          },
          required: [idArg],
        },
        annotations: { idempotentHint: true },
      },
      run: async (args, by) => finish(await content.publish(name, requireString(args, idArg), by, args.includeChildren !== false)),
    });
  }
  return tools;
}

/** One shared tool for every entity that opts in with `mcp.deleteDraft`. */
function deleteDraftTool(content: ContentService): Tool | undefined {
  const types = ENTITY_SPECS.filter((s) => s.mcp?.deleteDraft).map((s) => s.def.name);
  if (!types.length) return undefined;
  return {
    definition: {
      name: 'delete_draft',
      title: 'Delete draft',
      description:
        `Permanently delete one item that is still a draft (${types.join(', ')}). Published items are refused; ` +
        'unpublish them with set_status first only if the user asks. Deleting a draft topic also deletes its references, perspectives and links, ' +
        'and deleting a reference removes it from the points that cited it. Only call this when the user asks to discard something.',
      inputSchema: {
        type: 'object',
        properties: { type: { type: 'string', enum: types }, id: str('Item id (relation ids come from get_topic’s related[].relation.id).') },
        required: ['type', 'id'],
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    run: async (args, by) => {
      const type = args.type;
      if (typeof type !== 'string' || !types.includes(type as EntityName)) {
        throw new Error(`type must be one of: ${types.join(', ')}`);
      }
      return content.removeDraft(ENTITIES[type as EntityName].def.name, requireString(args, 'id'), by);
    },
  };
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
