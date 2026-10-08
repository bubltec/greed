/**
 * The shape every document source shares. A provider knows one upstream (a
 * court database, a register, an agency API); the tools and the rest of the
 * BFF only see these types, so a new source is one class and one registry line.
 */
export const DOCUMENT_KINDS = ['opinion', 'docket', 'filing', 'rule', 'notice', 'order', 'bill', 'hearing', 'record', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** A search hit or a document the caller can open with `read`. */
export interface DocumentRef {
  provider: string;
  /** The provider's own id, for debugging; `url` is what callers pass back. */
  id: string;
  url: string;
  title: string;
  kind: DocumentKind;
  /** ISO date (YYYY-MM-DD) when the provider has one. */
  publishedOn?: string;
  /** Court, agency or chamber. */
  issuer?: string;
  /** Untrusted excerpt from the provider. */
  snippet?: string;
}

export interface DocumentPage {
  /** 1-based. A source with no page breaks is one page. */
  page: number;
  text: string;
}

export interface SourceDocument extends DocumentRef {
  /** Docket number, citation, bill number: whatever identifies it in the field. */
  identifiers: Record<string, string>;
  pages: DocumentPage[];
  /** Documents inside this one (a docket's filings), to read next. */
  related: DocumentRef[];
  /** Why there is no text, when there isn't (not in RECAP, sealed, not yet digitised). */
  note?: string;
}

export interface SearchOptions {
  kind?: DocumentKind;
  limit?: number;
  /** Published on or after / on or before (YYYY-MM-DD). */
  from?: string;
  to?: string;
}

export interface DocumentProvider {
  /** Stable id used in tool arguments and output, e.g. "courtlistener". */
  readonly id: string;
  readonly name: string;
  /** The only hosts this provider will ever call or accept a URL for. */
  readonly hosts: readonly string[];
  readonly kinds: readonly DocumentKind[];
  /** False when its credential is missing, so tools can say so instead of failing. */
  configured(): boolean;
  /** True for a URL on one of this provider's hosts that `read` understands. */
  handles(url: URL): boolean;
  search(query: string, options: SearchOptions): Promise<DocumentRef[]>;
  /** Reads by public URL (the same link an editor would cite). */
  read(url: URL): Promise<SourceDocument>;
}

/** What `add_reference` takes, so a read document goes in as a citation. */
export interface ReferenceDraft {
  label: string;
  url: string;
  publishedOn?: string;
  excerpt?: string;
}
