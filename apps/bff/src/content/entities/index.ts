import type { EntityName } from '@greed/domain';
import type { EntitySpec } from '../entity.js';
import { outletSpec } from './outlet.js';
import { pageSpec } from './page.js';
import { perspectiveSpec } from './perspective.js';
import { referenceSpec } from './reference.js';
import { relationSpec } from './relation.js';
import { topicSpec } from './topic.js';

/**
 * The registry. A new content type is: a row in packages/domain/src/entity-defs.ts,
 * a DTO in content.dto.ts, a spec file here, and a line below. REST endpoints,
 * validation, cascading deletes, publishing and (opt-in, via `mcp`) connector
 * tools are derived from it.
 */
export const ENTITIES: Record<EntityName, EntitySpec> = {
  topic: topicSpec,
  reference: referenceSpec,
  perspective: perspectiveSpec,
  relation: relationSpec,
  outlet: outletSpec,
  page: pageSpec,
};

export const ENTITY_SPECS = Object.values(ENTITIES);
