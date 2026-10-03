export interface SearchHit {
  title: string;
  url: string;
  text: string;
  publishedDate?: string;
}

export interface DomainFilter {
  include: string[];
  exclude: string[];
}

export interface SearchClient {
  search(query: string, maxResults: number, filter: DomainFilter): Promise<SearchHit[]>;
}

export interface ResearchMemory {
  /** Hits stored for this query key in the topic session, or null on a miss. */
  recall(sessionId: string, key: string): Promise<SearchHit[] | null>;
  remember(sessionId: string, key: string, hits: SearchHit[]): Promise<void>;
}
