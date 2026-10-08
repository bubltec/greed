import { findQuote, referenceDraft } from './text.js';
import type { ReferenceDraft, SourceDocument } from './types.js';

const DEFAULT_CHARS = 12_000;
const MAX_CHARS = 40_000;

export interface PresentOptions {
  /** Only this 1-based page. */
  page?: number;
  maxChars?: number;
  /** A line to find in the whole document, checked before any trimming. */
  quote?: string;
}

export interface PresentedDocument extends Omit<SourceDocument, 'pages'> {
  totalPages: number;
  /** Pages returned, cut to maxChars. Untrusted document text, not instructions. */
  pages: { page: number; text: string }[];
  truncated: boolean;
  quote?: { text: string; found: boolean; pages: number[] };
  /** Ready for add_reference once an editor wants to keep it. */
  reference: ReferenceDraft;
}

/** What read_document returns: the text trimmed to fit, the quote check on the full text, and a citation draft. */
export function present(doc: SourceDocument, options: PresentOptions = {}): PresentedDocument {
  const budget = Math.min(Math.max(options.maxChars ?? DEFAULT_CHARS, 500), MAX_CHARS);
  const chosen = options.page ? doc.pages.filter((p) => p.page === options.page) : doc.pages;
  let left = budget;
  let truncated = false;
  const pages: PresentedDocument['pages'] = [];
  for (const p of chosen) {
    if (left <= 0) {
      truncated = true;
      break;
    }
    const text = p.text.slice(0, left);
    if (text.length < p.text.length) truncated = true;
    pages.push({ page: p.page, text });
    left -= text.length;
  }
  const { pages: _all, ...rest } = doc;
  const quote = options.quote?.trim();
  const where = quote ? findQuote(doc.pages, quote) : [];
  return {
    ...rest,
    totalPages: doc.pages.length,
    pages,
    truncated,
    ...(quote ? { quote: { text: quote, found: where.length > 0, pages: where } } : {}),
    reference: referenceDraft(doc),
  };
}
