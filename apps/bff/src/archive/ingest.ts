import { createHash } from 'node:crypto';
import { BadRequestException, BadGatewayException } from '@nestjs/common';
import { hostMatches, outletSearchLists } from '@greed/domain';
import type { ContentService } from '../content/content.service.js';
import { liveDocuments } from '../documents/index.js';
import { type Archive, archiveKey } from './archive.js';
import { type ExtractionOutcome, type Extractor, MAX_EXTRACTED_CHARS, readSafely } from './extract.js';

/**
 * Archiving a file by public URL. This is the one place the server fetches an
 * address a caller chose, so it is deliberately narrow:
 *
 * - https only, and only hosts the record already trusts: a document provider's
 *   hosts, or a published, non-paywalled outlet in the catalog (add the outlet
 *   first for any other primary source, e.g. justice.gov);
 * - redirects are followed by hand, up to three, and each hop is checked against
 *   the same allowlist, so an allowed host cannot bounce the fetch somewhere else;
 * - a size cap (the file must also fit in one Lambda response when it is served)
 *   and a content-type allowlist; anything else is refused, not stored.
 */

/**
 * 4 MB. A served file has to fit in one buffered Lambda response (6 MB), and the adapter
 * base64-encodes binary bodies, which adds a third: 4 MB becomes about 5.3 MB on the wire.
 */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_REDIRECTS = 3;

/** What can be archived. Images and PDFs are evidence; plain text covers transcripts. */
export const ATTACHMENT_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain'] as const;

/**
 * The archived types the Lambda adapter must base64-encode on the way out (lambda.ts). Without
 * this a served PDF or image arrives corrupted, which no in-process test would notice.
 */
export const BINARY_ATTACHMENT_MIME_TYPES: string[] = ATTACHMENT_MIME_TYPES.filter((t) => t !== 'text/plain');

export interface BinaryResponse {
  status: number;
  /** `location` and `content-type`, lowercased, when present. */
  headers: Record<string, string | undefined>;
  bytes: Uint8Array;
  /** The body ran past `maxBytes`, so `bytes` is empty. */
  tooLarge?: boolean;
}

/** One GET that never follows redirects and refuses to read past `maxBytes`. */
export type BinaryGet = (url: string, options: { maxBytes: number }) => Promise<BinaryResponse>;

export const BINARY_GET = Symbol('BINARY_GET');

export const liveBinaryGet: BinaryGet = async (url, { maxBytes }) => {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'greed-archive/1.0' } });
  const headers = { location: res.headers.get('location') ?? undefined, 'content-type': res.headers.get('content-type') ?? undefined };
  const declared = Number(res.headers.get('content-length'));
  const tooLarge = { status: res.status, headers, bytes: new Uint8Array(0), tooLarge: true };
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge;
  if (!res.body) return { status: res.status, headers, bytes: new Uint8Array(0) };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    // Returning from the loop cancels the stream, so nothing past the limit is read.
    if (total > maxBytes) return tooLarge;
    chunks.push(chunk);
  }
  return { status: res.status, headers, bytes: Buffer.concat(chunks) };
};

export interface ArchivedDocument {
  sha256: string;
  mimeType: string;
  bytes: number;
  /** The address the bytes actually came from, after any redirects. */
  sourceUrl: string;
  extractedText?: string;
  extractionStatus: 'pending' | 'done' | 'failed';
  /** Why there is no text, or a caution about machine-read text. For the caller, never stored. */
  extractionNote?: string;
}

/** The hosts a file may be fetched from, from the live providers and the published open outlets. */
export async function archivableHosts(content: ContentService): Promise<string[]> {
  const outlets = (await content.index(true)).snapshot.outlets ?? [];
  return [...liveDocuments().list().flatMap((p) => [...p.hosts]), ...outletSearchLists(outlets).include];
}

function checkUrl(raw: string, hosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('url must be an https URL');
  }
  if (url.protocol !== 'https:') throw new BadRequestException('url must be an https URL');
  if (url.username || url.password) throw new BadRequestException('url must not carry credentials');
  if (!hosts.some((h) => hostMatches(url.hostname, h))) {
    throw new BadRequestException(
      `${url.hostname} is not a trusted source. Files are archived only from document-provider hosts (${liveDocuments().list().flatMap((p) => p.hosts).join(', ')}) or published, non-paywalled outlets in list_outlets. Add the outlet first for another primary source.`,
    );
  }
  return url;
}

/** Fetches, checks, hashes and stores one file. Throws a BadRequest the caller can act on. */
export async function archiveFromUrl(
  rawUrl: string,
  deps: { archive: Archive; get: BinaryGet; hosts: readonly string[]; extractor?: Extractor },
): Promise<ArchivedDocument> {
  if (!deps.archive.configured()) throw new BadRequestException('The document archive is not configured for this stage');
  let url = checkUrl(rawUrl, deps.hosts);
  let res: BinaryResponse | undefined;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    res = await deps.get(url.toString(), { maxBytes: MAX_ATTACHMENT_BYTES });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (hop === MAX_REDIRECTS) throw new BadRequestException(`Too many redirects fetching ${rawUrl}`);
      url = checkUrl(new URL(res.headers.location, url).toString(), deps.hosts);
      continue;
    }
    break;
  }
  const response = res!;
  if (response.tooLarge) throw new BadRequestException(`File is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
  if (response.status === 404) throw new BadRequestException(`Nothing at ${url.toString()} (404)`);
  if (response.status < 200 || response.status >= 300) throw new BadGatewayException(`${url.hostname} returned ${response.status}`);
  const mimeType = (response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new BadRequestException(`${mimeType || 'An unknown type'} cannot be archived. Allowed: ${ATTACHMENT_MIME_TYPES.join(', ')}`);
  }
  if (response.bytes.byteLength === 0) throw new BadRequestException('The file is empty');
  if (response.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new BadRequestException(`File is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);

  const sha256 = createHash('sha256').update(response.bytes).digest('hex');
  await deps.archive.put(archiveKey(sha256), { bytes: response.bytes, mimeType });
  const local = extract(response.bytes, mimeType);
  // Text that needs no OCR is read here; a scan goes to the extractor when the stage has one.
  // Either way the file is already archived, so an OCR failure leaves a row to retry, not an error.
  const read =
    local.extractionStatus === 'done' || !deps.extractor?.configured()
      ? local
      : await readSafely(deps.extractor, { bytes: response.bytes, mimeType });
  return {
    sha256,
    mimeType,
    bytes: response.bytes.byteLength,
    sourceUrl: url.toString(),
    extractedText: read.extractedText,
    extractionStatus: read.extractionStatus,
    extractionNote: read.note,
  };
}

/**
 * Text that needs no OCR. Plain text is read as it is. A scan or image is left `pending`
 * for the extractor (when the stage has one) or for an editor to transcribe with update_attachment.
 */
export function extract(bytes: Uint8Array, mimeType: string): ExtractionOutcome {
  if (mimeType === 'text/plain') {
    const text = new TextDecoder('utf-8').decode(bytes).trim();
    return text ? { extractedText: text.slice(0, MAX_EXTRACTED_CHARS), extractionStatus: 'done' } : { extractionStatus: 'pending' };
  }
  return { extractionStatus: 'pending' };
}
