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

export interface SearchOptions {
  /** Longest passage kept per hit. Default 500; a source lookup asks for more. */
  maxText?: number;
}

export interface SearchClient {
  search(query: string, maxResults: number, filter: DomainFilter, options?: SearchOptions): Promise<SearchHit[]>;
}

export interface ResearchMemory {
  /** Hits stored for this query key in the topic session, or null on a miss. */
  recall(sessionId: string, key: string): Promise<SearchHit[] | null>;
  remember(sessionId: string, key: string, hits: SearchHit[]): Promise<void>;
}
