import { BadRequestException, Injectable } from '@nestjs/common';
import { ContentService } from '../content/content.service.js';
import { bespokeTools } from './bespoke-tools.js';
import { crudTools } from './crud-tools.js';
import type { Tool, ToolDefinition } from './tool.js';

/**
 * Tool dispatch. Most tools are generated from the entity registry (crud-tools.ts);
 * the rest are in bespoke-tools.ts. Every write goes through ContentService and
 * the same DTO validation as the web CMS, so the integrity rules can't be bypassed.
 * Everything the connector creates starts as a draft; only the explicit
 * publish tools make content public.
 */
@Injectable()
export class McpService {
  private readonly tools: Map<string, Tool>;

  constructor(content: ContentService) {
    this.tools = new Map([...bespokeTools(content), ...crudTools(content)].map((t) => [t.definition.name, t]));
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
