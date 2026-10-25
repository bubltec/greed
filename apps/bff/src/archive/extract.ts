import { DetectDocumentTextCommand } from '@aws-sdk/client-textract';
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
  read(file: ArchivedFile): Promise<ExtractionOutcome>;
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

export class TextractExtractor implements Extractor {
  constructor(private readonly client: Sender) {}

  configured() {
    return true;
  }

  async read(file: ArchivedFile): Promise<ExtractionOutcome> {
    if (!OCR_TYPES.includes(file.mimeType)) {
      return { extractionStatus: 'pending', note: `${file.mimeType} cannot be read automatically; transcribe it with update_attachment` };
    }
    let blocks: { BlockType?: string; Text?: string }[] | undefined;
    try {
      blocks = (await this.client.send(new DetectDocumentTextCommand({ Document: { Bytes: file.bytes } }))).Blocks;
    } catch (error) {
      if (UNREADABLE.includes((error as { name?: string }).name ?? '')) {
        return { extractionStatus: 'pending', note: 'Textract cannot read this file inline (a PDF must be a single page); transcribe it with update_attachment' };
      }
      throw error;
    }
    const text = (blocks ?? [])
      .filter((b) => b.BlockType === 'LINE' && b.Text)
      .map((b) => b.Text)
      .join('\n')
      .trim();
    if (!text) return { extractionStatus: 'pending', note: 'No text was found in the file' };
    return { extractionStatus: 'done', extractedText: text.slice(0, MAX_EXTRACTED_CHARS), note: 'Machine-read text: check it against the file before quoting' };
  }
}

/** Runs an extractor so that a failure is an outcome, never an exception: the file is archived either way. */
export async function readSafely(extractor: Extractor, file: ArchivedFile): Promise<ExtractionOutcome> {
  try {
    return await extractor.read(file);
  } catch (error) {
    return { extractionStatus: 'failed', note: `Text extraction failed: ${error instanceof Error ? error.message : 'unknown error'}` };
  }
}
