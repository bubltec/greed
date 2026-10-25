import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { ARCHIVE, type Archive, UnconfiguredArchive } from '../archive/archive.js';
import { BINARY_GET, type BinaryGet, liveBinaryGet } from '../archive/ingest.js';
import { ContentService } from '../content/content.service.js';
import { attachmentTools } from './attachment-tools.js';
import { auditTools } from './audit-tools.js';
import { bespokeTools } from './bespoke-tools.js';
import { crudTools } from './crud-tools.js';
import type { Tool, ToolDefinition } from './tool.js';

/**
 * Tool dispatch. Most tools are generated from the entity registry (crud-tools.ts);
 * the rest are in bespoke-tools.ts, audit-tools.ts and attachment-tools.ts. Every write goes through ContentService and
 * the same DTO validation as the web CMS, so the integrity rules can't be bypassed.
 * Everything the connector creates starts as a draft; only the explicit
 * publish tools make content public.
 */
@Injectable()
export class McpService {
  private readonly tools: Map<string, Tool>;

  constructor(
    content: ContentService,
    @Optional() @Inject(ARCHIVE) archive: Archive = new UnconfiguredArchive(),
    @Optional() @Inject(BINARY_GET) get: BinaryGet = liveBinaryGet,
  ) {
    this.tools = new Map(
      [...bespokeTools(content), ...auditTools(content), ...attachmentTools(content, archive, get), ...crudTools(content)].map((t) => [t.definition.name, t]),
    );
  }

  listTools(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  async call(name: string, args: Record<string, unknown>, by: string): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new BadRequestException(`Unknown tool: ${name}`);
    return tool.run(args, by);
  }
}
