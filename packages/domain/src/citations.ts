/**
 * The original narrative doc cited sources inline as a trailing parenthetical:
 *   "... happened. (Washington Post (https://...); NPR)"
 * These helpers split that into clean text plus structured citations, so each
 * becomes a Reference instead of a string buried in prose.
 */

export interface ParsedCitation {
  label: string;
  url?: string;
}

export interface ParsedPoint {
  text: string;
  citations: ParsedCitation[];
}

/** Index of the "(" that balances the ")" at `close`, or -1. */
function matchingOpen(s: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (s[i] === ')') depth++;
    else if (s[i] === '(') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      parts.push(s.slice(start, i));
      start = i + sep.length;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseCitation(raw: string): ParsedCitation | undefined {
  // \S+ is greedy, so URLs that contain parentheses (Wikipedia's "Name_(role)") survive intact.
  const withUrl = raw.match(/^(.*?)\s*\((https?:\/\/\S+)\)\s*$/);
  if (withUrl) return { label: withUrl[1]!.trim() || hostOf(withUrl[2]!), url: withUrl[2]! };
  const bareUrl = raw.match(/^(https?:\/\/\S+)$/);
  if (bareUrl) return { label: hostOf(bareUrl[1]!), url: bareUrl[1]! };
  return raw.trim() ? { label: raw.trim() } : undefined;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * A trailing parenthetical counts as a citation only if it is short and
 * source-like; "(the National Association of Realtors)" in the middle of a
 * sentence stays prose. Heuristic: it ends the point and either holds a URL or
 * every part is short, none is a sentence, and the first is capitalised.
 */
export function parsePoint(input: string): ParsedPoint {
  const trimmed = input.trim();
  if (!trimmed.endsWith(')')) return { text: trimmed, citations: [] };
  const open = matchingOpen(trimmed, trimmed.length - 1);
  if (open <= 0) return { text: trimmed, citations: [] };
  const inner = trimmed.slice(open + 1, -1);
  const before = trimmed.slice(0, open).trimEnd();
  // Citation groups follow the sentence's own punctuation: "...happened. (Source)".
  if (!/[.!?"'”’\]]$/.test(before)) return { text: trimmed, citations: [] };
  const parts = splitTopLevel(inner, ';');
  const looksLikeSources =
    /https?:\/\//.test(inner) ||
    (/^[A-Z0-9"'“]/.test(parts[0] ?? '') &&
      parts.every((p) => p.length <= 140 && !/[.!?]$/.test(p)));
  if (!looksLikeSources) return { text: trimmed, citations: [] };
  const citations = parts.map(parseCitation).filter((c): c is ParsedCitation => !!c);
  return { text: before, citations };
}
