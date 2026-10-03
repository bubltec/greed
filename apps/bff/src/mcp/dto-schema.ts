import 'reflect-metadata';
import { getMetadataStorage } from 'class-validator';
import { defaultMetadataStorage } from 'class-transformer/cjs/storage.js';

type Schema = Record<string, unknown>;
type Meta = ReturnType<ReturnType<typeof getMetadataStorage>['getTargetValidationMetadatas']>[number];
type Cls = new () => object;

export interface SchemaOptions {
  /** Field descriptions keyed by dotted path ("sections.points.text"). */
  docs?: Record<string, string>;
  /** Top-level fields to leave out. */
  omit?: Iterable<string>;
  /** Top-level fields the caller may leave out because a default fills them. */
  defaults?: Iterable<string>;
  /** Nothing is required (partial updates). */
  partial?: boolean;
}

/** Validation metadata for each decorated property of a DTO class, by property name. */
function metasByProperty(cls: Cls): Map<string, Meta[]> {
  const byProp = new Map<string, Meta[]>();
  for (const meta of getMetadataStorage().getTargetValidationMetadatas(cls, '', true, false)) {
    byProp.set(meta.propertyName, [...(byProp.get(meta.propertyName) ?? []), meta]);
  }
  return byProp;
}

/** The DTO's property names. */
export const dtoKeys = (cls: Cls): string[] => [...metasByProperty(cls).keys()];

/**
 * A JSON Schema for a request DTO, read from its class-validator decorators, so
 * the tool schemas can't drift from what the CMS validates. Descriptions are
 * the one thing decorators can't carry; pass them in `docs`.
 */
export function dtoSchema(cls: Cls, options: SchemaOptions = {}, path = ''): Schema {
  const omit = new Set(options.omit ?? []);
  const defaults = new Set(options.defaults ?? []);
  const properties: Record<string, Schema> = {};
  const required: string[] = [];
  for (const [prop, metas] of metasByProperty(cls)) {
    if (!path && omit.has(prop)) continue;
    properties[prop] = propertySchema(cls, prop, metas, options, `${path}${prop}`);
    const optional = metas.some((m) => m.name === 'isOptional');
    if (!optional && !options.partial && !(!path && defaults.has(prop))) required.push(prop);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

function propertySchema(cls: Cls, prop: string, metas: Meta[], options: SchemaOptions, path: string): Schema {
  const named = (name: string, each = false) => metas.find((m) => m.name === name && !!m.each === each);
  const description = options.docs?.[path];
  const base: Schema = {};

  if (metas.some((m) => m.type === 'nestedValidation')) {
    const element = defaultMetadataStorage.findTypeMetadata(cls, prop)?.typeFunction() as Cls | undefined;
    base.type = 'array';
    if (element) base.items = dtoSchema(element, { ...options, omit: [], defaults: [], partial: false }, `${path}.`);
  } else if (named('isArray')) {
    base.type = 'array';
    base.items = {
      type: 'string',
      ...(named('maxLength', true) ? { maxLength: named('maxLength', true)!.constraints![0] } : {}),
    };
  } else if (named('isIn')) {
    base.type = 'string';
    base.enum = named('isIn')!.constraints![0];
  } else if (named('isBoolean')) {
    base.type = 'boolean';
  } else {
    base.type = 'string';
    const length = named('isLength');
    if (length) {
      base.minLength = length.constraints![0];
      base.maxLength = length.constraints![1];
    }
    if (named('maxLength')) base.maxLength = named('maxLength')!.constraints![0];
    if (named('matches')) base.pattern = (named('matches')!.constraints![0] as RegExp).source;
    if (named('isUrl')) base.format = 'uri';
  }
  const max = named('arrayMaxSize');
  if (max) base.maxItems = max.constraints![0];
  const min = named('arrayMinSize');
  if (min) base.minItems = min.constraints![0];
  return description ? { ...base, description } : base;
}
