import { Client, StreamableHTTPClientTransport, type FetchLike } from '@modelcontextprotocol/client';
import type { DomainFilter, SearchClient, SearchHit, SearchOptions } from './types.js';
import { signedFetch } from './signed-fetch.js';

export interface GatewaySearchClientOptions {
  gatewayUrl: string;
  region: string;
  /** Tests stand in for the gateway. Production signs with the AWS credential chain. */
  fetchImpl?: FetchLike;
  toolName?: string;
}

export function normalizeGatewayUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('/mcp') ? trimmed : `${trimmed}/mcp`;
}

/**
 * MCP client for an AgentCore Gateway that hosts Web Search (connector 1.2.0+).
 * The SDK owns the session and the JSON-RPC. Domain filters are how paywalled
 * outlets are skipped. IAM only; no search key.
 */
export class GatewaySearchClient implements SearchClient {
  private readonly gatewayUrl: string;
  private readonly fetchImpl: FetchLike;
  private toolName: string;
  private session: Promise<Client> | undefined;

  constructor(options: GatewaySearchClientOptions) {
    this.gatewayUrl = normalizeGatewayUrl(options.gatewayUrl);
    this.fetchImpl = options.fetchImpl ?? signedFetch(options.region);
    this.toolName = options.toolName ?? '';
  }

  async search(query: string, maxResults: number, filter: DomainFilter, options: SearchOptions = {}): Promise<SearchHit[]> {
    const client = await this.connect();
    const domainFilter: { include?: string[]; exclude?: string[] } = {
      ...(filter.include.length ? { include: filter.include } : {}),
      ...(filter.exclude.length ? { exclude: filter.exclude } : {}),
    };
    const result = await client.callTool({
      name: this.toolName,
      arguments: {
        query: query.slice(0, 200),
        maxResults,
        ...(domainFilter.include || domainFilter.exclude ? { filters: { domainFilter } } : {}),
      },
    });
    if (result.isError) {
      const text = result.content.map((block) => (block.type === 'text' ? block.text : '')).join(' ').trim();
      throw new Error(text || 'Web search failed');
    }
    return parseSearchHits(result, options.maxText);
  }

  private connect(): Promise<Client> {
    if (!this.session) {
      const pending = this.open();
      this.session = pending;
      pending.catch(() => {
        if (this.session === pending) this.session = undefined;
      });
    }
    return this.session;
  }

  private async open(): Promise<Client> {
    const client = new Client({ name: 'greed-research', version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(this.gatewayUrl), { fetch: this.fetchImpl }));
    if (!this.toolName) this.toolName = await this.resolveSearchToolName(client);
    return client;
  }

  private async resolveSearchToolName(client: Client): Promise<string> {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).filter((name) => name.length > 0);
    const match = names.find((name) => /^web[_-]?search$/i.test(name)) ?? names.find((name) => /search/i.test(name));
    if (!match) throw new Error(`Gateway has no search tool. Available: ${names.join(', ') || '(none)'}`);
    return match;
  }
}

export function parseSearchHits(result: unknown, maxText = 500): SearchHit[] {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
  const textBlock = content?.find((block) => block.type === 'text' && block.text)?.text;
  if (!textBlock) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock);
  } catch {
    return [];
  }
  const rows = (parsed as { results?: unknown[] }).results;
  if (!Array.isArray(rows)) return [];
  const hits: SearchHit[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const title = typeof item.title === 'string' ? item.title : '';
    const url = typeof item.url === 'string' ? item.url : '';
    const text = typeof item.text === 'string' ? item.text : '';
    if (!title && !text && !url) continue;
    hits.push({
      title,
      url,
      text: text.slice(0, maxText),
      publishedDate: typeof item.publishedDate === 'string' ? item.publishedDate : undefined,
    });
  }
  return hits;
}
