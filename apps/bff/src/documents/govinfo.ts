import { BadRequestException } from '@nestjs/common';
import { ensureOk, type HttpGet, liveGet } from './http.js';
import { paginate, plain } from './text.js';
import type { DocumentKind, DocumentProvider, DocumentRef, SearchOptions, SourceDocument } from './types.js';

const SITE = 'https://www.govinfo.gov';
const API = 'https://api.govinfo.gov';
/** Longest text read from one document; a long hearing is still read, past this is cut and noted. */
const MAX_TEXT = 2_000_000;
/** Ids go into API paths, so they are limited to what GovInfo issues (CREC-2026-10-01-pt1-PgH6015-2, CHRG-119shrg60276). */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type Row = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v.filter((r) => r && typeof r === 'object') as Row[]) : []);

const KIND_OF: Record<string, DocumentKind> = { BILLS: 'bill', CREC: 'record', CRECB: 'record', CHRG: 'hearing', USCOURTS: 'opinion' };
/** Collections searched for each kind; with no kind, the ones editors cite. */
const COLLECTIONS: Partial<Record<DocumentKind, string[]>> = { bill: ['BILLS'], record: ['CREC'], hearing: ['CHRG'], opinion: ['USCOURTS'] };
const DEFAULT_COLLECTIONS = ['BILLS', 'CREC', 'CHRG', 'CRPT', 'CDOC', 'CMR', 'USCOURTS'];

export interface GovInfoTarget {
  packageId: string;
  granuleId?: string;
}

/** /app/details/PKG[/GRANULE] and /content/pkg/PKG/html/GRANULE.htm. */
export function parseGovInfoUrl(url: URL): GovInfoTarget | undefined {
  const parts = url.pathname.split('/').filter(Boolean);
  let packageId: string | undefined;
  let granuleId: string | undefined;
  if (parts[0] === 'app' && parts[1] === 'details') {
    packageId = parts[2];
    granuleId = parts[3];
  } else if (parts[0] === 'content' && parts[1] === 'pkg' && parts.length >= 4) {
    packageId = parts[2];
    granuleId = parts.length >= 5 ? parts[parts.length - 1]!.replace(/\.[A-Za-z0-9]+$/, '') : undefined;
  }
  if (!packageId || !ID.test(packageId) || (granuleId !== undefined && !ID.test(granuleId))) return undefined;
  return granuleId && granuleId !== packageId ? { packageId, granuleId } : { packageId };
}

/**
 * GovInfo (GPO): Congressional Record, bills, hearings, reports and federal
 * court opinions. Needs an api.data.gov key, sent in a header, never in a URL.
 * Calls only api.govinfo.gov.
 */
export class GovInfoProvider implements DocumentProvider {
  readonly id = 'govinfo';
  readonly name = 'GovInfo';
  readonly hosts = ['govinfo.gov'] as const;
  readonly kinds: readonly DocumentKind[] = ['bill', 'record', 'hearing', 'opinion'];

  constructor(
    private readonly key: () => string | undefined,
    private readonly get: HttpGet = liveGet,
  ) {}

  configured(): boolean {
    return Boolean(this.key());
  }

  handles(url: URL): boolean {
    return parseGovInfoUrl(url) !== undefined;
  }

  async search(query: string, options: SearchOptions): Promise<DocumentRef[]> {
    const collections = options.kind ? COLLECTIONS[options.kind] : DEFAULT_COLLECTIONS;
    if (!collections) return [];
    const clauses = [`collection:(${collections.join(' OR ')})`, `(${query})`];
    if (options.from || options.to) clauses.push(`publishdate:range(${options.from ?? '1000-01-01'},${options.to ?? '9999-12-31'})`);
    const body = (await this.call('/search', {
      method: 'POST',
      body: {
        query: clauses.join(' '),
        pageSize: Math.min(Math.max(options.limit ?? 10, 1), 20),
        offsetMark: '*',
        sorts: [{ field: 'score', sortOrder: 'DESC' }],
        historical: true,
        resultLevel: 'default',
      },
    })) as Row;
    return rows(body.results).flatMap((r) => {
      const packageId = str(r.packageId);
      if (!packageId || !ID.test(packageId)) return [];
      const granuleId = str(r.granuleId);
      const code = str(r.collectionCode) ?? '';
      return [
        {
          provider: this.id,
          id: granuleId ?? packageId,
          url: detailsUrl({ packageId, granuleId }),
          title: str(r.title) ?? packageId,
          kind: KIND_OF[code] ?? 'other',
          publishedOn: str(r.dateIssued),
          issuer: authors(r),
        },
      ];
    });
  }

  async read(url: URL): Promise<SourceDocument> {
    const target = parseGovInfoUrl(url);
    if (!target) throw new BadRequestException(`GovInfo link not recognised: ${url.pathname}`);
    const { packageId, granuleId } = target;
    const pkg = (await this.call(`/packages/${packageId}/summary`)) as Row;
    const granule = granuleId ? await this.optional(`/packages/${packageId}/granules/${granuleId}/summary`) : undefined;
    const htm = granuleId ? `/packages/${packageId}/granules/${granuleId}/htm` : `/packages/${packageId}/htm`;
    const raw = await this.text(htm);
    const clipped = raw.length > MAX_TEXT;
    const text = plain(raw.slice(0, MAX_TEXT));
    const identifiers: Record<string, string> = { packageId, ...(granuleId ? { granuleId } : {}) };
    for (const [key, value] of [['congress', pkg.congress], ['docClass', pkg.docClass], ['suDocClass', pkg.suDocClassNumber], ['pages', pkg.pages]] as const) {
      if (str(value)) identifiers[key] = str(value)!;
    }
    const notes = [clipped ? 'Text cut at 2,000,000 characters.' : '', text ? '' : 'GovInfo has no text rendition for this document.'].filter(Boolean);
    return {
      provider: this.id,
      id: granuleId ?? packageId,
      url: detailsUrl(target),
      title: str(granule?.title) ?? str(pkg.title) ?? packageId,
      kind: KIND_OF[str(pkg.collectionCode) ?? ''] ?? 'other',
      publishedOn: str(granule?.dateIssued) ?? str(pkg.dateIssued),
      issuer: authors(pkg) ?? str(pkg.chamber),
      identifiers,
      pages: paginate(text),
      related: [],
      ...(notes.length ? { note: notes.join(' ') } : {}),
    };
  }

  private async optional(path: string): Promise<Row | undefined> {
    try {
      return (await this.call(path)) as Row;
    } catch {
      return undefined;
    }
  }

  private async call(path: string, post?: { method: 'POST'; body: unknown }): Promise<unknown> {
    return (await this.request(path, post)).json();
  }

  private async text(path: string): Promise<string> {
    return (await this.request(path)).text();
  }

  private async request(path: string, post?: { method: 'POST'; body: unknown }) {
    const key = this.key();
    if (!key) throw new BadRequestException('govinfo is not configured for this stage');
    const headers: Record<string, string> = { 'X-Api-Key': key, Accept: post ? 'application/json' : '*/*' };
    if (post) headers['Content-Type'] = 'application/json';
    const res = await this.get(`${API}${path}`, { headers, ...(post ? { method: 'POST' as const, body: JSON.stringify(post.body) } : {}) });
    return ensureOk(res, this.name);
  }
}

/** A granule with the package's own id is the package itself. */
const detailsUrl = ({ packageId, granuleId }: GovInfoTarget) =>
  `${SITE}/app/details/${packageId}${granuleId && granuleId !== packageId ? `/${granuleId}` : ''}`;

function authors(r: Row): string | undefined {
  const list = Array.isArray(r.governmentAuthor) ? (r.governmentAuthor as unknown[]).filter((a): a is string => typeof a === 'string') : [];
  const joined = (list.length ? list : [str(r.governmentAuthor1), str(r.governmentAuthor2)].filter((a): a is string => Boolean(a))).join('; ');
  return joined || undefined;
}
