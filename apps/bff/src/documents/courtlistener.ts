import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import { paginate, plain } from './text.js';
import type { DocumentKind, DocumentProvider, DocumentRef, SearchOptions, SourceDocument } from './types.js';

const ORIGIN = 'https://www.courtlistener.com';
const API = `${ORIGIN}/api/rest/v4`;
const MAX_OPINIONS = 5;
const MAX_ENTRIES = 50;

export interface HttpResponse {
  status: number;
  json(): Promise<unknown>;
}
export type HttpGet = (url: string, init: { headers: Record<string, string> }) => Promise<HttpResponse>;

type Row = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v.filter((r) => r && typeof r === 'object') as Row[]) : []);

const liveGet: HttpGet = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });

/** What `search` type= each kind maps to on CourtListener. */
const SEARCH_TYPE: Partial<Record<DocumentKind, string>> = { opinion: 'o', docket: 'r', filing: 'rd' };

export type CourtListenerTarget =
  | { type: 'opinion'; clusterId: string }
  | { type: 'docket'; docketId: string }
  | { type: 'filing'; docketId: string; number: string };

/** /opinion/{cluster}/{slug}/, /docket/{id}/{slug}/ and /docket/{id}/{number}/{slug}/. */
export function parseCourtListenerUrl(url: URL): CourtListenerTarget | undefined {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'opinion' && /^\d+$/.test(parts[1] ?? '')) return { type: 'opinion', clusterId: parts[1]! };
  if (parts[0] === 'docket' && /^\d+$/.test(parts[1] ?? '')) {
    return /^\d+$/.test(parts[2] ?? '') ? { type: 'filing', docketId: parts[1]!, number: parts[2]! } : { type: 'docket', docketId: parts[1]! };
  }
  return undefined;
}

/**
 * CourtListener (Free Law Project): opinions, PACER dockets and RECAP filings.
 * Calls only www.courtlistener.com with the token in a header; the token is
 * never put in a URL or returned.
 */
export class CourtListenerProvider implements DocumentProvider {
  readonly id = 'courtlistener';
  readonly name = 'CourtListener';
  readonly hosts = ['courtlistener.com'] as const;
  readonly kinds: readonly DocumentKind[] = ['opinion', 'docket', 'filing'];

  constructor(
    private readonly token: () => string | undefined,
    private readonly get: HttpGet = liveGet,
  ) {}

  configured(): boolean {
    return Boolean(this.token());
  }

  handles(url: URL): boolean {
    return parseCourtListenerUrl(url) !== undefined;
  }

  async search(query: string, options: SearchOptions): Promise<DocumentRef[]> {
    const kinds = options.kind ? [options.kind] : (['opinion', 'docket'] as DocumentKind[]);
    const types = kinds.flatMap((k) => SEARCH_TYPE[k] ?? []);
    if (types.length === 0) return [];
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 20);
    const all = await Promise.all(
      types.map(async (type) => {
        const body = (await this.api(`/search/?${new URLSearchParams({ q: query, type })}`)) as Row;
        return rows(body.results).slice(0, limit).map((r) => toRef(type, r));
      }),
    );
    return all.flat().filter((r): r is DocumentRef => r !== undefined);
  }

  async read(url: URL): Promise<SourceDocument> {
    const target = parseCourtListenerUrl(url);
    if (!target) throw new BadRequestException(`CourtListener link not recognised: ${url.pathname}`);
    if (target.type === 'opinion') return this.opinion(target.clusterId, url);
    if (target.type === 'docket') return this.docket(target.docketId, url);
    return this.filing(target.docketId, target.number, url);
  }

  private async opinion(clusterId: string, url: URL): Promise<SourceDocument> {
    const cluster = (await this.api(`/clusters/${clusterId}/`)) as Row;
    const docketRow = await this.optional(str(cluster.docket));
    const texts: string[] = [];
    for (const href of (Array.isArray(cluster.sub_opinions) ? cluster.sub_opinions : []).slice(0, MAX_OPINIONS)) {
      const op = (await this.api(this.own(String(href)))) as Row;
      const body = str(op.plain_text) ?? plain(str(op.html_with_citations) ?? str(op.html) ?? '');
      if (body) texts.push(`[${str(op.type) ?? 'opinion'}]\n${body}`);
    }
    const citations = rows(cluster.citations)
      .map((c) => [c.volume, c.reporter, c.page].filter(Boolean).join(' '))
      .filter(Boolean);
    return {
      provider: this.id,
      id: clusterId,
      url: url.href,
      title: str(cluster.case_name) ?? str(cluster.case_name_full) ?? `Opinion ${clusterId}`,
      kind: 'opinion',
      publishedOn: str(cluster.date_filed),
      issuer: str(docketRow?.court_id),
      identifiers: {
        ...(citations.length ? { citation: citations.join('; ') } : {}),
        ...(str(docketRow?.docket_number) ? { docketNumber: str(docketRow?.docket_number)! } : {}),
      },
      pages: paginate(texts.join('\n\n')),
      related: [],
      ...(texts.length ? {} : { note: 'CourtListener has no text for this opinion.' }),
    };
  }

  private async docket(docketId: string, url: URL): Promise<SourceDocument> {
    const docket = (await this.api(`/dockets/${docketId}/`)) as Row;
    const slug = slugOf(str(docket.absolute_url), url);
    const entries = rows(((await this.api(`/docket-entries/?${new URLSearchParams({ docket: docketId, order_by: 'entry_number' })}`)) as Row).results).slice(0, MAX_ENTRIES);
    const lines = entries.map((e) => `#${e.entry_number ?? '?'} ${str(e.date_filed) ?? ''} ${str(e.description) ?? ''}`.trim());
    const related = entries.flatMap((e) =>
      rows(e.recap_documents)
        .filter((d) => d.is_available === true && num(d.attachment_number) === undefined && str(d.document_number))
        .map((d): DocumentRef => ({
          provider: this.id,
          id: String(d.id ?? ''),
          url: `${ORIGIN}/docket/${docketId}/${str(d.document_number)}/${slug}/`,
          title: `${str(docket.case_name) ?? 'Docket'} no. ${str(d.document_number)}${str(d.short_description) ? `: ${str(d.short_description)}` : ''}`,
          kind: 'filing',
          publishedOn: str(e.date_filed),
        })),
    );
    return {
      provider: this.id,
      id: docketId,
      url: url.href,
      title: str(docket.case_name) ?? `Docket ${docketId}`,
      kind: 'docket',
      publishedOn: str(docket.date_filed),
      issuer: str(docket.court_id),
      identifiers: str(docket.docket_number) ? { docketNumber: str(docket.docket_number)! } : {},
      pages: paginate(lines.join('\n')),
      related,
      ...(lines.length ? {} : { note: 'No docket entries in RECAP for this case.' }),
    };
  }

  private async filing(docketId: string, number: string, url: URL): Promise<SourceDocument> {
    const found = rows(
      ((await this.api(`/recap-documents/?${new URLSearchParams({ docket_entry__docket: docketId, document_number: number })}`)) as Row).results,
    );
    const doc = found.find((d) => num(d.attachment_number) === undefined || d.attachment_number === null) ?? found[0];
    if (!doc) throw new NotFoundException(`No filing ${number} on docket ${docketId} in RECAP`);
    const docket = await this.optional(`${API}/dockets/${docketId}/`);
    const text = str(doc.plain_text) ?? '';
    return {
      provider: this.id,
      id: String(doc.id ?? `${docketId}-${number}`),
      url: url.href,
      title: `${str(docket?.case_name) ?? `Docket ${docketId}`} no. ${number}${str(doc.short_description) ? `: ${str(doc.short_description)}` : ''}`,
      kind: 'filing',
      publishedOn: str(doc.date_filed) ?? str(docket?.date_filed),
      issuer: str(docket?.court_id),
      identifiers: { ...(str(docket?.docket_number) ? { docketNumber: str(docket?.docket_number)! } : {}), filing: number, ...(num(doc.page_count) ? { pages: String(num(doc.page_count)) } : {}) },
      pages: paginate(text),
      related: [],
      ...(text ? {} : { note: doc.is_available === false ? 'This filing is not in RECAP, so there is no text.' : 'RECAP has no extracted text for this filing yet.' }),
    };
  }

  /** Only follows links that stay on the CourtListener API. */
  private own(href: string): string {
    if (!href.startsWith(`${API}/`)) throw new BadGatewayException('CourtListener returned a link outside its API');
    return href.slice(API.length);
  }

  private async optional(href: string | undefined): Promise<Row | undefined> {
    if (!href?.startsWith(`${API}/`)) return undefined;
    try {
      return (await this.api(href.slice(API.length))) as Row;
    } catch {
      return undefined;
    }
  }

  private async api(path: string): Promise<unknown> {
    const token = this.token();
    if (!token) throw new BadRequestException('courtlistener is not configured for this stage');
    const res = await this.get(`${API}${path}`, { headers: { Authorization: `Token ${token}`, Accept: 'application/json' } });
    if (res.status === 404) throw new NotFoundException('CourtListener has no such record');
    if (res.status === 429) throw new BadGatewayException('CourtListener rate limit reached; try again in a minute');
    if (res.status === 401 || res.status === 403) throw new BadGatewayException('CourtListener rejected the API token');
    if (res.status < 200 || res.status >= 300) throw new BadGatewayException(`CourtListener returned ${res.status}`);
    return res.json();
  }
}

function slugOf(absoluteUrl: string | undefined, fallback: URL): string {
  const fromApi = absoluteUrl?.split('/').filter(Boolean).pop();
  return fromApi ?? fallback.pathname.split('/').filter(Boolean).pop() ?? 'case';
}

function toRef(type: string, r: Row): DocumentRef | undefined {
  const path = str(r.absolute_url) ?? str(r.docket_absolute_url);
  if (!path) return undefined;
  const kind: DocumentKind = type === 'o' ? 'opinion' : type === 'rd' ? 'filing' : 'docket';
  return {
    provider: 'courtlistener',
    id: String(r.cluster_id ?? r.docket_id ?? r.id ?? ''),
    url: path.startsWith('http') ? path : `${ORIGIN}${path}`,
    title: str(r.caseName) ?? str(r.caseNameFull) ?? str(r.case_name) ?? 'Untitled',
    kind,
    publishedOn: str(r.dateFiled)?.slice(0, 10),
    issuer: str(r.court) ?? str(r.court_id),
    snippet: snippetOf(r),
  };
}

function snippetOf(r: Row): string | undefined {
  const first = rows(r.opinions)[0] ?? rows(r.recap_documents)[0];
  const raw = str(first?.snippet) ?? str(r.snippet) ?? str(r.description);
  return raw ? plain(raw).slice(0, 500) : undefined;
}
