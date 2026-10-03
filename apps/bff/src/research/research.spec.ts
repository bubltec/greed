import { describe, expect, it, vi } from 'vitest';
import { InMemoryContentStore, type Outlet, type Topic } from '@greed/domain';
import { ContentService } from '../content/content.service.js';
import { GatewaySearchClient, parseSearchHits } from './gateway.js';
import { AgentCoreResearchMemory } from './memory.js';
import { liveResearch, researchKey, researchQueries, researchSessionId, researchTopic } from './research.js';
import { signedFetch } from './signed-fetch.js';
import type { ResearchMemory, SearchClient, SearchHit } from './types.js';

const at = '2026-01-01T00:00:00.000Z';

function topic(id = 'oil'): Topic {
  return {
    id,
    kind: 'case',
    title: 'Oil money and the EPA',
    summary: 'Donations preceded rollbacks.',
    sections: [],
    disputed: 'The industry says the timing is coincidence.',
    notes: '',
    tags: [],
    createdAt: at,
    updatedAt: at,
    status: 'published',
  };
}

function outlet(partial: Partial<Outlet> & Pick<Outlet, 'name' | 'domain'>): Outlet {
  return {
    id: partial.domain.replace(/\./g, '-'),
    paywall: false,
    accuracy: 'high',
    bias: 'low',
    oneSided: false,
    factual: 'high',
    createdAt: at,
    updatedAt: at,
    status: 'published',
    ...partial,
  };
}

function service(outlets: Outlet[] = [], extra: Topic[] = []) {
  return new ContentService(new InMemoryContentStore({ topics: [topic(), ...extra], outlets }));
}

describe('researchQueries', () => {
  it('asks for the claim, the denial, and a primary document, each within 200 characters', () => {
    const queries = researchQueries({ ...topic(), summary: 'x'.repeat(400), disputed: '' });
    expect(queries).toHaveLength(3);
    expect(queries.every((q) => q.length <= 200)).toBe(true);
    expect(queries[1]).toMatch(/denial/);
    expect(queries[2]).toMatch(/filing/);
    expect(researchSessionId('oil').length).toBeGreaterThan(33);
    expect(researchKey('a', ['npr.org'], [])).not.toBe(researchKey('a', ['npr.org'], ['cnn.com']));
  });
});

describe('researchTopic', () => {
  const npr = outlet({ name: 'NPR', domain: 'npr.org' });
  const cnn = outlet({ name: 'CNN', domain: 'cnn.com', paywall: true, accuracy: 'mixed' });

  it('does not search when web search is not configured', async () => {
    const report = await researchTopic(service([npr]), 'oil', {});
    expect(report.configured).toBe(false);
    expect(report.hits).toEqual([]);
  });

  it('does not search the open web when every outlet is paywalled or still a draft', async () => {
    const report = await researchTopic(service([cnn, { ...npr, status: 'draft' }]), 'oil', { search: { search: vi.fn() } });
    expect(report.configured).toBe(true);
    expect(report.hits).toEqual([]);
    expect(report.skippedPaywalls.map((o) => o.domain)).toEqual(['cnn.com']);
    expect(report.message).toMatch(/publish an open outlet/);
  });

  it('reuses a stored search and does not call Web Search again', async () => {
    const stored: SearchHit[] = [{ title: 'NPR', url: 'https://www.npr.org/story', text: 'A passage.', publishedDate: '2026-09-01' }];
    const memory: ResearchMemory = { recall: vi.fn(async () => stored), remember: vi.fn() };
    const search: SearchClient = { search: vi.fn() };
    const report = await researchTopic(service([npr, cnn]), 'oil', { search, memory });
    expect(search.search).not.toHaveBeenCalled();
    expect(memory.remember).not.toHaveBeenCalled();
    expect(report.queries.every((q) => q.fromMemory)).toBe(true);
    expect(report.hits[0]).toMatchObject({ url: stored[0]!.url, outlet: 'NPR', fromMemory: true });
    expect(report.skippedPaywalls.map((o) => o.name)).toEqual(['CNN']);
  });

  it('searches the misses, remembers them, and drops paywalled or already-cited urls', async () => {
    const memory = new Map<string, SearchHit[]>();
    const store: ResearchMemory = {
      recall: async (_session, key) => memory.get(key) ?? null,
      remember: async (_session, key, hits) => {
        memory.set(key, hits);
      },
    };
    const search: SearchClient = {
      search: vi.fn(async (query) => [
        { title: query, url: 'https://www.npr.org/a', text: 'open' },
        { title: 'wall', url: 'https://www.cnn.com/b', text: 'closed' },
        { title: 'cited', url: 'https://www.npr.org/already', text: 'have it' },
        { title: 'other', url: 'https://example.com/c', text: 'not on the list' },
      ]),
    };
    const svc = service([npr, cnn]);
    await svc.create('reference', { label: 'NPR', url: 'https://www.npr.org/already' }, 'ed', 'oil');
    const first = await researchTopic(svc, 'oil', { search, memory: store });
    expect(search.search).toHaveBeenCalledTimes(3);
    expect(first.hits.map((h) => h.url)).toEqual(['https://www.npr.org/a']);
    expect(first.queries.every((q) => !q.fromMemory)).toBe(true);
    const filter = (search.search as ReturnType<typeof vi.fn>).mock.calls[0]![2];
    expect(filter).toEqual({ include: ['npr.org'], exclude: ['cnn.com'] });

    (search.search as ReturnType<typeof vi.fn>).mockClear();
    const second = await researchTopic(svc, 'oil', { search, memory: store });
    expect(search.search).not.toHaveBeenCalled();
    expect(second.queries.every((q) => q.fromMemory)).toBe(true);
  });

  it('keeps going when one query fails and does not remember that query', async () => {
    const remember = vi.fn();
    const search: SearchClient = {
      search: vi.fn(async (query) => {
        if (query.includes('filing')) throw new Error('timeout');
        return [{ title: 'ok', url: `https://npr.org/${encodeURIComponent(query).slice(0, 12)}`, text: 'x' }];
      }),
    };
    const report = await researchTopic(service([npr]), 'oil', { search, memory: { recall: async () => null, remember } });
    expect(report.queries.filter((q) => q.error)).toHaveLength(1);
    expect(report.hits.length).toBeGreaterThan(0);
    expect(remember).toHaveBeenCalledTimes(2);
  });

  it('searches anyway when memory cannot be read or written', async () => {
    const search: SearchClient = {
      search: vi.fn(async () => [{ title: 'ok', url: 'https://npr.org/live', text: 't' }]),
    };
    const report = await researchTopic(service([npr]), 'oil', {
      search,
      memory: {
        recall: async () => {
          throw new Error('AccessDenied');
        },
        remember: async () => {
          throw new Error('AccessDenied');
        },
      },
    });
    expect(search.search).toHaveBeenCalledTimes(3);
    expect(report.queries.every((q) => !q.error && !q.fromMemory)).toBe(true);
    expect(report.hits.map((h) => h.url)).toEqual(['https://npr.org/live']);
  });

  it('runs the three searches together', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const search: SearchClient = {
      search: vi.fn(async (query) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return [{ title: 'ok', url: `https://npr.org/${query.includes('filing') ? 'p' : query.includes('industry') ? 'd' : 'c'}`, text: 't' }];
      }),
    };
    await researchTopic(service([npr]), 'oil', { search });
    expect(maxInFlight).toBe(3);
  });

  it('searches without a memory store, caps the dive, and records a non-error failure', async () => {
    const search: SearchClient = {
      search: vi.fn(async (query) => {
        if (query.includes('Donations')) throw 'boom';
        return Array.from({ length: 8 }, (_, i) => ({
          title: String(i),
          url: i === 1 ? 'https://npr.org/same' : `https://npr.org/${query.includes('filing') ? 'p' : 'd'}-${i}`,
          text: 't',
        }));
      }),
    };
    const report = await researchTopic(service([npr]), 'oil', { search });
    expect(report.hits).toHaveLength(12);
    expect(report.queries.some((q) => q.error === 'boom')).toBe(true);
    expect(report.hits.filter((h) => h.url === 'https://npr.org/same')).toHaveLength(1);
  });

  it('drops a stored hit whose url is not a page', async () => {
    const memory: ResearchMemory = { recall: async () => [{ title: 'x', url: 'not a url', text: 't' }], remember: vi.fn() };
    const search: SearchClient = { search: vi.fn() };
    const report = await researchTopic(service([npr]), 'oil', { search, memory });
    expect(search.search).not.toHaveBeenCalled();
    expect(report.hits).toEqual([]);
  });

  it('treats a snapshot with no outlet list as an empty catalog', async () => {
    const content = {
      find: async () => topic(),
      index: async () => ({ snapshot: { references: [], topics: [] } }),
    };
    const report = await researchTopic(content as never, 'oil', {});
    expect(report.configured).toBe(false);
    expect(report.searched).toEqual([]);
  });
});

describe('liveResearch', () => {
  it('wires the gateway and memory when the stage is configured', () => {
    const prev = {
      gateway: process.env.AGENTCORE_GATEWAY_URL,
      memory: process.env.AGENTCORE_MEMORY_ID,
    };
    process.env.AGENTCORE_GATEWAY_URL = 'https://gw.example';
    process.env.AGENTCORE_MEMORY_ID = 'mem-1';
    try {
      const deps = liveResearch();
      expect(deps.search).toBeInstanceOf(GatewaySearchClient);
      expect(deps.memory).toBeInstanceOf(AgentCoreResearchMemory);
    } finally {
      if (prev.gateway === undefined) delete process.env.AGENTCORE_GATEWAY_URL;
      else process.env.AGENTCORE_GATEWAY_URL = prev.gateway;
      if (prev.memory === undefined) delete process.env.AGENTCORE_MEMORY_ID;
      else process.env.AGENTCORE_MEMORY_ID = prev.memory;
    }
  });
});

interface Rpc {
  method?: string;
  id?: number;
  params?: { protocolVersion?: string; arguments?: Record<string, unknown> };
}

/** Enough of a streamable-HTTP gateway for the MCP client to complete a search. */
function gatewayFetch(onCall: (rpc: Rpc) => unknown) {
  const calls: Rpc[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    if ((init?.method ?? 'GET').toUpperCase() !== 'POST') return new Response('no stream', { status: 405 });
    const rpc = JSON.parse(String(init?.body)) as Rpc;
    calls.push(rpc);
    if (rpc.id == null) return new Response(null, { status: 202, headers: { 'mcp-session-id': 's' } });
    const result =
      rpc.method === 'initialize'
        ? { protocolVersion: rpc.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'test', version: '0' } }
        : onCall(rpc);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'mcp-session-id': 's' },
    });
  });
  return { calls, fetchImpl };
}

describe('GatewaySearchClient', () => {
  it('sends the domain filter and parses snippet hits', async () => {
    const { calls, fetchImpl } = gatewayFetch((rpc) =>
      rpc.method === 'tools/list'
        ? { tools: [{ name: 'WebSearch', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: JSON.stringify({ results: [{ title: 'T', url: 'https://npr.org/x', text: 'p', publishedDate: '2026-01-02' }, {}] }) }] },
    );
    const client = new GatewaySearchClient({ gatewayUrl: 'https://gw.example', region: 'us-east-1', fetchImpl, toolName: '' });
    const hits = await client.search('oil', 5, { include: ['npr.org'], exclude: ['cnn.com'] });
    expect(hits).toEqual([{ title: 'T', url: 'https://npr.org/x', text: 'p', publishedDate: '2026-01-02' }]);
    const call = calls.find((rpc) => rpc.method === 'tools/call');
    expect(call?.params?.arguments).toMatchObject({
      maxResults: 5,
      filters: { domainFilter: { include: ['npr.org'], exclude: ['cnn.com'] } },
    });
    expect(parseSearchHits({})).toEqual([]);
    expect(parseSearchHits({ content: [{ type: 'text', text: 'not-json' }] })).toEqual([]);
    expect(parseSearchHits({ content: [{ type: 'text', text: '{"results":{}}' }] })).toEqual([]);
  });

  it('resolves a search tool, skips an empty filter, and reuses the session', async () => {
    const { calls, fetchImpl } = gatewayFetch((rpc) => {
      if (rpc.method === 'tools/list') return { tools: [{ name: '', inputSchema: { type: 'object' } }, { name: 'site-search', inputSchema: { type: 'object' } }] };
      const text = JSON.stringify({
        results: [null, 'nope', { title: 1, url: 1, text: 'x'.repeat(600) }, { title: '', url: '', text: '' }, { title: 'ok', url: 'https://npr.org/y' }],
      });
      return { content: [{ type: 'text', text }] };
    });
    const client = new GatewaySearchClient({ gatewayUrl: 'https://gw.example', region: 'us-east-1', fetchImpl });
    const hits = await client.search('oil', 5, { include: [], exclude: [] });
    expect(hits).toEqual([
      { title: '', url: '', text: 'x'.repeat(500), publishedDate: undefined },
      { title: 'ok', url: 'https://npr.org/y', text: '', publishedDate: undefined },
    ]);
    expect(calls.find((rpc) => rpc.method === 'tools/call')?.params?.arguments).not.toHaveProperty('filters');
    await client.search('oil', 5, { include: [], exclude: ['cnn.com'] });
    const searches = calls.filter((rpc) => rpc.method === 'tools/call');
    expect(searches).toHaveLength(2);
    expect(searches[1]?.params?.arguments).toMatchObject({ filters: { domainFilter: { exclude: ['cnn.com'] } } });
    expect(calls.filter((rpc) => rpc.method === 'initialize')).toHaveLength(1);
    const secondSearch = fetchImpl.mock.calls.filter((call) => {
      const body = (call[1] as RequestInit | undefined)?.body;
      if (!body) return false;
      return (JSON.parse(String(body)) as Rpc).method === 'tools/call';
    })[1];
    expect(secondSearch).toBeDefined();
    expect(new Headers((secondSearch![1] as RequestInit).headers).get('mcp-session-id')).toBe('s');
  });

  it('reports a missing tool, a failed search, and an HTTP failure', async () => {
    const none = gatewayFetch(() => ({ tools: [] }));
    await expect(
      new GatewaySearchClient({ gatewayUrl: 'https://gw.example', region: 'us-east-1', fetchImpl: none.fetchImpl }).search('oil', 5, { include: ['npr.org'], exclude: [] }),
    ).rejects.toThrow(/\(none\)/);

    const named = gatewayFetch(() => ({ tools: [{ name: 'ping', inputSchema: { type: 'object' } }] }));
    await expect(
      new GatewaySearchClient({ gatewayUrl: 'https://gw.example', region: 'us-east-1', fetchImpl: named.fetchImpl }).search('oil', 5, { include: ['npr.org'], exclude: [] }),
    ).rejects.toThrow(/ping/);

    const failed = gatewayFetch(() => ({ isError: true, content: [{ type: 'text', text: 'nope' }] }));
    await expect(
      new GatewaySearchClient({ gatewayUrl: 'https://gw.example', region: 'us-east-1', fetchImpl: failed.fetchImpl, toolName: 'WebSearch' }).search('oil', 5, {
        include: ['npr.org'],
        exclude: [],
      }),
    ).rejects.toThrow(/nope/);

    const down = new GatewaySearchClient({
      gatewayUrl: 'https://gw.example',
      region: 'us-east-1',
      toolName: 'WebSearch',
      fetchImpl: vi.fn(async () => new Response('down', { status: 503 })),
    });
    await expect(down.search('oil', 5, { include: ['npr.org'], exclude: [] })).rejects.toThrow(/down/);
    expect(new GatewaySearchClient({ gatewayUrl: 'https://gw.example/', region: 'us-east-1' })).toBeInstanceOf(GatewaySearchClient);
  });
});

describe('AgentCoreResearchMemory', () => {
  it('recalls a matching event and writes the next one with the query key', async () => {
    const sent: unknown[] = [];
    const client = {
      send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        sent.push(command.input);
        if (command.constructor.name === 'ListEventsCommand') {
          return {
            events: [
              {
                metadata: { researchKey: { stringValue: 'other' } },
                payload: [{ conversational: { content: { text: '{"hits":[]}' } } }],
              },
              {
                metadata: { researchKey: { stringValue: 'key' } },
                payload: [{ conversational: { content: { text: JSON.stringify({ hits: [{ title: 'T', url: 'https://npr.org', text: 'p' }] }) } } }],
              },
            ],
          };
        }
        return {};
      }),
    };
    const memory = new AgentCoreResearchMemory({ memoryId: 'mem', region: 'us-east-1', client: client as never, now: () => new Date('2026-10-03T00:00:00.000Z') });
    expect(await memory.recall('session', 'key')).toEqual([{ title: 'T', url: 'https://npr.org', text: 'p' }]);
    expect(await memory.recall('session', 'missing')).toBeNull();
    const pages = new AgentCoreResearchMemory({
      memoryId: 'mem',
      region: 'us-east-1',
      client: {
        send: vi.fn(async (command: { input: { nextToken?: string; filter?: { eventMetadata?: unknown[] } } }) => {
          expect(command.input.filter?.eventMetadata).toHaveLength(1);
          if (!command.input.nextToken) return { events: [], nextToken: 'page-2' };
          expect(command.input.nextToken).toBe('page-2');
          return {
            events: [
              {
                metadata: { researchKey: { stringValue: 'key' } },
                payload: [{ conversational: { content: { text: JSON.stringify({ hits: [{ title: 'Later', url: 'https://npr.org/p', text: 'p' }] }) } } }],
              },
            ],
          };
        }),
      } as never,
    });
    expect(await pages.recall('session', 'key')).toEqual([{ title: 'Later', url: 'https://npr.org/p', text: 'p' }]);
    const loose = new AgentCoreResearchMemory({
      memoryId: 'mem',
      region: 'us-east-1',
      client: {
        send: vi.fn(async (command: { constructor: { name: string } }) => {
          if (command.constructor.name !== 'ListEventsCommand') return {};
          return {
            events: [
              { metadata: { researchKey: { stringValue: 'key' } }, payload: [{ conversational: {} }] },
              { metadata: { researchKey: { stringValue: 'key' } }, payload: [{ conversational: { content: { text: 'nope' } } }] },
              { metadata: { researchKey: { stringValue: 'key' } }, payload: [{ conversational: { content: { text: '{"hits":{}}' } } }] },
              { metadata: { researchKey: { stringValue: 'key' } } },
            ],
          };
        }),
      } as never,
    });
    expect(await loose.recall('session', 'key')).toBeNull();
    const empty = new AgentCoreResearchMemory({
      memoryId: 'mem',
      region: 'us-east-1',
      client: { send: vi.fn(async () => ({})) } as never,
    });
    expect(await empty.recall('session', 'gone')).toBeNull();
    await empty.remember('session', 'gone', []);
    expect(new AgentCoreResearchMemory({ memoryId: 'mem', region: 'us-east-1' })).toBeInstanceOf(AgentCoreResearchMemory);
    await memory.remember('session', 'key', [{ title: 'T', url: 'https://npr.org', text: 'p' }]);
    expect(sent.at(-1)).toMatchObject({ sessionId: 'session', clientToken: 'key', metadata: { researchKey: { stringValue: 'key' } } });
  });
});

describe('signedFetch', () => {
  it('signs with the AWS credential chain and sends that request', async () => {
    const seen: Request[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(input as Request);
      return new Response('ok');
    };
    const call = signedFetch('us-east-1', fetchImpl, async () => ({
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secret',
      sessionToken: 'token',
    }));
    await call('https://gw.example/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(seen[0]!.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(seen[0]!.headers.get('authorization')).toContain('bedrock-agentcore');
    expect(seen[0]!.headers.get('x-amz-security-token')).toBe('token');
  });
});
