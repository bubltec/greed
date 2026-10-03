/** JSON Schemas for the MCP tools. Descriptions are written for the model that calls them. */
export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

/** A tool: its definition, and what it does. */
export interface Tool {
  definition: ToolDefinition;
  run(args: Record<string, unknown>, by: string): Promise<unknown>;
}
