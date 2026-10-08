import type { DocumentPage, ReferenceDraft, SourceDocument } from './types.js';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Provider text as plain text: tags dropped, common entities decoded, blank runs collapsed. */
export function plain(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?>|<\/(p|div|h\d|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, name: string) => ENTITIES[name] ?? m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Splits on form feeds (how PDF text extractors mark a page); text with none is page 1. */
export function paginate(text: string): DocumentPage[] {
  const pages = text.split('\f').map((t) => t.trim());
  while (pages.length > 1 && !pages[pages.length - 1]) pages.pop();
  return pages.map((t, i) => ({ page: i + 1, text: t }));
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Where a quoted line appears: the 1-based pages that contain it, ignoring case,
 * curly quotes, dashes and line breaks. A quote that spans a page break is found
 * by joining neighbours, and reported against both pages.
 */
export function findQuote(pages: readonly DocumentPage[], quote: string): number[] {
  const needle = fold(quote);
  if (!needle) return [];
  const found = new Set<number>();
  const texts = pages.map((p) => fold(p.text));
  texts.forEach((t, i) => {
    if (t.includes(needle)) found.add(pages[i]!.page);
  });
  if (found.size === 0) {
    for (let i = 0; i + 1 < texts.length; i++) {
      if (`${texts[i]} ${texts[i + 1]}`.includes(needle)) {
        found.add(pages[i]!.page);
        found.add(pages[i + 1]!.page);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** The citation an editor would save for this document. */
export function referenceDraft(doc: SourceDocument): ReferenceDraft {
  const id = Object.values(doc.identifiers)[0];
  return {
    label: [doc.title, id, doc.issuer].filter(Boolean).join(', ').slice(0, 200),
    url: doc.url,
    ...(doc.publishedOn ? { publishedOn: doc.publishedOn.slice(0, 7) } : {}),
  };
}
