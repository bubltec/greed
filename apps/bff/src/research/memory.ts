import { BedrockAgentCoreClient, CreateEventCommand, ListEventsCommand } from '@aws-sdk/client-bedrock-agentcore';
import type { ResearchMemory, SearchHit } from './types.js';

/** One shared actor: a search of public reporting is not a private chat. */
export const RESEARCH_ACTOR_ID = 'greed-research';

const KEY = 'researchKey';

export interface AgentCoreResearchMemoryOptions {
  memoryId: string;
  region: string;
  client?: Pick<BedrockAgentCoreClient, 'send'>;
  now?: () => Date;
}

/**
 * Short-term memory for one topic session. A later dive lists the session's
 * events and reuses a stored tool result instead of calling Web Search again.
 * Events expire with the memory resource (seven days).
 */
export class AgentCoreResearchMemory implements ResearchMemory {
  private readonly memoryId: string;
  private readonly client: Pick<BedrockAgentCoreClient, 'send'>;
  private readonly now: () => Date;

  constructor(options: AgentCoreResearchMemoryOptions) {
    this.memoryId = options.memoryId;
    this.client = options.client ?? new BedrockAgentCoreClient({ region: options.region });
    this.now = options.now ?? (() => new Date());
  }

  async recall(sessionId: string, key: string): Promise<SearchHit[] | null> {
    let nextToken: string | undefined;
    do {
      const result = await this.client.send(
        new ListEventsCommand({
          memoryId: this.memoryId,
          actorId: RESEARCH_ACTOR_ID,
          sessionId,
          includePayloads: true,
          maxResults: 20,
          nextToken,
          filter: {
            eventMetadata: [
              {
                left: { metadataKey: KEY },
                operator: 'EQUALS_TO',
                right: { metadataValue: { stringValue: key } },
              },
            ],
          },
        }),
      );
      for (const event of result.events ?? []) {
        if (event.metadata?.[KEY]?.stringValue !== key) continue;
        const hits = hitsFromPayload(event.payload);
        if (hits) return hits;
      }
      nextToken = result.nextToken;
    } while (nextToken);
    return null;
  }

  async remember(sessionId: string, key: string, hits: SearchHit[]): Promise<void> {
    await this.client.send(
      new CreateEventCommand({
        memoryId: this.memoryId,
        actorId: RESEARCH_ACTOR_ID,
        sessionId,
        eventTimestamp: this.now(),
        clientToken: key,
        metadata: { [KEY]: { stringValue: key } },
        payload: [
          {
            conversational: {
              role: 'ASSISTANT',
              content: { text: JSON.stringify({ hits }) },
            },
          },
        ],
      }),
    );
  }
}

function hitsFromPayload(payload: { conversational?: { content?: { text?: string } } }[] | undefined): SearchHit[] | null {
  for (const item of payload ?? []) {
    const text = item.conversational?.content?.text;
    if (!text) continue;
    try {
      const parsed = JSON.parse(text) as { hits?: SearchHit[] };
      if (Array.isArray(parsed.hits)) return parsed.hits;
    } catch {
      continue;
    }
  }
  return null;
}
