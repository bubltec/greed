import { BadRequestException } from '@nestjs/common';
import { ensureOk, type HttpGet, liveGet } from './http.js';
import { paginate, plain } from './text.js';
import type { DocumentKind, DocumentProvider, DocumentRef, SearchOptions, SourceDocument } from './types.js';

const ORIGIN = 'https://www.federalregister.gov';
const API = `${ORIGIN}/api/v1`;
const FIELDS = ['title', 'html_url', 'document_number', 'publication_date', 'type', 'abstract', 'agency_names', 'excerpts'];

type Row = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The Federal Register's own type codes for each kind. */
const TYPES: Partial<Record<DocumentKind, string[]>> = { rule: ['RULE', 'PRORULE'], notice: ['NOTICE'], order: ['PRESDOCU'] };
const KIND_OF: Record<string, DocumentKind> = { Rule: 'rule', 'Proposed Rule': 'rule', Notice: 'notice', 'Presidential Document': 'order' };

/** /documents/2025/01/28/2025-01902/slug and the short /d/2025-01902. */
export function federalRegisterNumber(url: URL): string | undefined {
  const parts = url.pathname.split('/').filter(Boolean);
  const candidate = parts[0] === 'd' ? parts[1] : parts[0] === 'documents' ? parts.slice(1).find((p) => /^(?:\d{4}|[A-Z]\d)-\d+$/i.test(p)) : undefined;
  return candidate && /^(?:\d{4}|[A-Z]\d)-\d+$/i.test(candidate) ? candidate : undefined;
}

/**
 * Federal Register (OFR/NARA): rules, proposed rules, notices and presidential
 * documents including executive orders. Public API, no key. Calls only
 * www.federalregister.gov.
 */
export class FederalRegisterProvider implements DocumentProvider {
  readonly id = 'federalregister';
  readonly name = 'Federal Register';
  readonly hosts = ['federalregister.gov'] as const;
  readonly kinds: readonly DocumentKind[] = ['rule', 'notice', 'order'];

  constructor(private readonly get: HttpGet = liveGet) {}

  configured(): boolean {
    return true;
  }

  handles(url: URL): boolean {
    return federalRegisterNumber(url) !== undefined;
  }

  async search(query: string, options: SearchOptions): Promise<DocumentRef[]> {
    const wanted = options.kind ? TYPES[options.kind] : undefined;
    if (options.kind && !wanted) return [];
    const params = new URLSearchParams({ 'conditions[term]': query, per_page: String(Math.min(Math.max(options.limit ?? 10, 1), 20)), order: 'relevance' });
    for (const t of wanted ?? []) params.append('conditions[type][]', t);
    if (options.from) params.set('conditions[publication_date][gte]', options.from);
    if (options.to) params.set('conditions[publication_date][lte]', options.to);
    for (const f of FIELDS) params.append('fields[]', f);
    const body = (await this.json(`/documents.json?${params}`)) as Row;
    return (Array.isArray(body.results) ? (body.results as Row[]) : []).flatMap((r) => {
      const url = str(r.html_url);
      const number = str(r.document_number);
      if (!url || !number) return [];
      const ref: DocumentRef = {
        provider: this.id,
        id: number,
        url,
        title: str(r.title) ?? number,
        kind: KIND_OF[str(r.type) ?? ''] ?? 'other',
        publishedOn: str(r.publication_date),
        issuer: strings(r.agency_names).join('; ') || undefined,
        snippet: plain(str(r.excerpts) ?? str(r.abstract) ?? '').slice(0, 500) || undefined,
      };
      return [ref];
    });
  }

  async read(url: URL): Promise<SourceDocument> {
    const number = federalRegisterNumber(url);
    if (!number) throw new BadRequestException(`Federal Register link not recognised: ${url.pathname}`);
    const doc = (await this.json(`/documents/${encodeURIComponent(number)}.json`)) as Row;
    const rawUrl = str(doc.raw_text_url);
    let text = '';
    if (rawUrl?.startsWith(`${ORIGIN}/`)) {
      text = plain(await (ensureOk(await this.get(rawUrl, { headers: {} }), this.name)).text());
    }
    const agencies = (Array.isArray(doc.agencies) ? (doc.agencies as Row[]) : []).map((a) => str(a.name)).filter((n): n is string => Boolean(n));
    const identifiers: Record<string, string> = { documentNumber: number };
    if (str(doc.citation)) identifiers.citation = str(doc.citation)!;
    if (str(doc.executive_order_number)) identifiers.executiveOrder = str(doc.executive_order_number)!;
    const abstract = str(doc.abstract);
    return {
      provider: this.id,
      id: number,
      url: str(doc.html_url) ?? url.href,
      title: str(doc.title) ?? number,
      kind: KIND_OF[str(doc.type) ?? ''] ?? 'other',
      publishedOn: str(doc.publication_date),
      issuer: agencies.join('; ') || undefined,
      identifiers,
      pages: paginate(text),
      related: [],
      ...(text ? {} : { note: abstract ? `No full text available. Abstract: ${abstract}` : 'The Federal Register has no text for this document.' }),
    };
  }

  private async json(path: string): Promise<unknown> {
    return ensureOk(await this.get(`${API}${path}`, { headers: { Accept: 'application/json' } }), this.name).json();
  }
}
