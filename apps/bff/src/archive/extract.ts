import { DetectDocumentTextCommand, GetDocumentTextDetectionCommand, StartDocumentTextDetectionCommand } from '@aws-sdk/client-textract';
import type { ArchivedFile } from './archive.js';

export const EXTRACTOR = Symbol('EXTRACTOR');

/** Longest text kept on one attachment row. */
export const MAX_EXTRACTED_CHARS = 200_000;

export interface ExtractionOutcome {
  /** `done` always comes with text. `pending` is nothing readable yet; `failed` is an error worth retrying. */
  extractionStatus: 'pending' | 'done' | 'failed';
  extractedText?: string;
  /** Why the text is missing, for the caller. Never stored. */
  note?: string;
}

/**
 * Reads the text out of a scan or image. A port, so tests use a fake and a stage without OCR says so.
 * What comes back is a machine reading of someone else's document: untrusted, to be checked
 * against the file before it is quoted.
 */
export interface Extractor {
  configured(): boolean;
  read(file: ExtractInput): Promise<ExtractionOutcome>;
}

/** The file, and where the archive holds it (`attachments/<sha256>`), for readers that work from storage. */
export interface ExtractInput extends ArchivedFile {
  key: string;
}

export class NoExtractor implements Extractor {
  configured() {
    return false;
  }

  async read(): Promise<ExtractionOutcome> {
    return { extractionStatus: 'pending', note: 'Text extraction is not configured for this stage' };
  }
}

/** Anything with a `send`, so the real AWS client and a test fake both fit. */
export interface Sender {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(command: any): Promise<any>;
}

/** The types Textract's synchronous call reads. */
const OCR_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

/** Textract answers these when the document cannot be read inline, e.g. a PDF with more than one page. */
const UNREADABLE = ['UnsupportedDocumentException', 'BadDocumentException', 'DocumentTooLargeException'];

export interface TextractOptions {
  /** The archive bucket. With it, a PDF too long to read inline goes to Textract's asynchronous API. */
  bucket?: string;
  /** How long one call waits on an asynchronous job before leaving it for a retry. Default 12 s. */
  budgetMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface TextractBlock {
  BlockType?: string;
  Text?: string;
  Page?: number;
}

const lineText = (blocks: TextractBlock[]) =>
  blocks
    .filter((b) => b.BlockType === 'LINE' && b.Text)
    .map((b) => b.Text)
    .join('\n')
    .trim();

export class TextractExtractor implements Extractor {
  private readonly options: Required<Omit<TextractOptions, 'bucket'>> & { bucket?: string };

  constructor(
    private readonly client: Sender,
    options: TextractOptions = {},
  ) {
    this.options = { budgetMs: 12_000, pollMs: 2_000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now, ...options };
  }

  configured() {
    return true;
  }

  async read(file: ExtractInput): Promise<ExtractionOutcome> {
    if (!OCR_TYPES.includes(file.mimeType)) {
      return { extractionStatus: 'pending', note: `${file.mimeType} cannot be read automatically; transcribe it with update_attachment` };
    }
    let blocks: { BlockType?: string; Text?: string }[] | undefined;
    try {
      blocks = (await this.client.send(new DetectDocumentTextCommand({ Document: { Bytes: file.bytes } }))).Blocks;
    } catch (error) {
      if (UNREADABLE.includes((error as { name?: string }).name ?? '')) {
        // A PDF of several pages cannot be read inline; it can be read from the archive as a job.
        if (file.mimeType === 'application/pdf' && this.options.bucket) return this.readJob(file.key);
        return { extractionStatus: 'pending', note: 'Textract cannot read this file inline (a PDF must be a single page); transcribe it with update_attachment' };
      }
      throw error;
    }
    const text = lineText(blocks ?? []);
    if (!text) return { extractionStatus: 'pending', note: 'No text was found in the file' };
    return { extractionStatus: 'done', extractedText: text.slice(0, MAX_EXTRACTED_CHARS), note: 'Machine-read text: check it against the file before quoting' };
  }

  /**
   * Reads a multi-page PDF straight from the archive. The job's idempotency token is the file's hash, so
   * calling again (after the wait ran out) picks up the same job rather than paying for another.
   */
  private async readJob(key: string): Promise<ExtractionOutcome> {
    const { bucket, budgetMs, pollMs, sleep, now } = this.options;
    const started = await this.client.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
        ClientRequestToken: key.slice(key.lastIndexOf('/') + 1).slice(0, 64),
      }),
    );
    const jobId = started.JobId as string | undefined;
    if (!jobId) return { extractionStatus: 'failed', note: 'Textract did not start a job' };

    const deadline = now() + budgetMs;
    const blocks: TextractBlock[] = [];
    let nextToken: string | undefined;
    for (;;) {
      const page = await this.client.send(new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken: nextToken }));
      if (page.JobStatus === 'IN_PROGRESS') {
        if (now() >= deadline) {
          return { extractionStatus: 'pending', note: 'Textract is still reading this PDF; run extract_attachment_text again in a minute' };
        }
        await sleep(pollMs);
        continue;
      }
      if (page.JobStatus !== 'SUCCEEDED') {
        // PARTIAL_SUCCESS means some pages are missing: incomplete evidence is not stored as complete.
        const why = page.JobStatus === 'PARTIAL_SUCCESS' ? 'some pages could not be read' : (page.StatusMessage ?? 'the job failed');
        return { extractionStatus: 'failed', note: `Textract: ${why}` };
      }
      blocks.push(...((page.Blocks as TextractBlock[] | undefined) ?? []));
      if (!page.NextToken) break;
      nextToken = page.NextToken as string;
    }
    const pages = new Map<number, TextractBlock[]>();
    for (const block of blocks) pages.set(block.Page ?? 1, [...(pages.get(block.Page ?? 1) ?? []), block]);
    const text = [...pages.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, list]) => lineText(list))
      .filter(Boolean)
      .join('\n\n');
    if (!text) return { extractionStatus: 'pending', note: 'No text was found in the file' };
    return {
      extractionStatus: 'done',
      extractedText: text.slice(0, MAX_EXTRACTED_CHARS),
      note: `Machine-read text from ${pages.size} page${pages.size === 1 ? '' : 's'}: check it against the file before quoting`,
    };
  }
}

/** Runs an extractor so that a failure is an outcome, never an exception: the file is archived either way. */
export async function readSafely(extractor: Extractor, file: ExtractInput): Promise<ExtractionOutcome> {
  try {
    return await extractor.read(file);
  } catch (error) {
    return { extractionStatus: 'failed', note: `Text extraction failed: ${error instanceof Error ? error.message : 'unknown error'}` };
  }
}
