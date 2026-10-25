import { statusOf, type ContentSnapshot, type Status } from './entities.js';

/**
 * Bulk content audit: deterministic checks over a whole snapshot, so a model
 * can review hundreds of entries from one compact report instead of reading
 * every topic. Three families:
 *
 * - text: encoding/escaping damage in prose fields (HTML entities, percent
 *   encoding, literal escapes, mojibake, raw HTML, control characters), with
 *   a repaired `after` value when the repair is unambiguous;
 * - structure: uncited points, orphaned references, near-duplicate
 *   perspectives, published topics whose draft children stay invisible;
 * - staleness: "as of" dates and pending language older than a threshold.
 *
 * Prose fields support only `**bold**`, `[text](url)` and `[[topic-id]]`
 * (site pages add the Markdown subset in pages.ts); URLs are never treated
 * as prose, so legitimate percent-encoding and `&` in links are untouched.
 */

export const AUDIT_CATEGORIES = ['text', 'structure', 'staleness'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_CODES = [
  'ENC_HTML_ENTITY',
  'ENC_DOUBLE',
  'ENC_PERCENT',
  'ESC_QUOTE',
  'ESC_NEWLINE',
  'ESC_UNICODE',
  'MOJIBAKE',
  'HTML_TAG',
  'CTRL_CHAR',
  'DOUBLE_SPACE',
  'QUOTE_MIX',
  'UNSUPPORTED_MARKUP',
  'POINT_NO_CITATION',
  'REF_ORPHAN',
  'PERSPECTIVE_NEAR_DUP',
  'PUBLISHED_WITH_DRAFT_CHILD',
  'STALE_DATE',
] as const;
export type AuditCode = (typeof AUDIT_CODES)[number];

export type AuditConfidence = 'high' | 'medium' | 'low';
export type AuditItemType = 'topic' | 'reference' | 'perspective' | 'relation' | 'outlet' | 'attachment' | 'page';

export interface AuditFinding {
  category: AuditCategory;
  code: AuditCode;
  confidence: AuditConfidence;
  type: AuditItemType;
  id: string;
  topicId: string;
  topicTitle: string;
  /** Dotted path, e.g. `summary`, `sections.0.points.2.text`, `tags.1`, `draft.body`. */
  field: string;
  /** The field's current value (for structure findings: what was found). Absent when not meaningful. */
  before?: string;
  /** The repaired full field value. Present only when a repair is offered. */
  after?: string;
  message: string;
  /** One compact line for a model to scan: `topic | type:id | field | CODE confidence | before → after`. */
  line: string;
}

export interface AuditOptions {
  /** Topic ids to scope to; omit for everything (outlets and pages included only unscoped). */
  ids?: readonly string[];
  categories?: readonly AuditCategory[];
  status?: Status | 'all';
  /** Days after which a dated or pending claim counts as stale. Default 90. */
  staleDays?: number;
  /** ISO timestamp the staleness clock runs against. Default: now. */
  now?: string;
}

export interface AuditReport {
  scanned: { topics: number; references: number; perspectives: number; relations: number; outlets: number; attachments: number; pages: number; fields: number };
  total: number;
  counts: Partial<Record<AuditCode, number>>;
  findings: AuditFinding[];
}

// ---------------------------------------------------------------------------
// Text repair

export interface TextIssue {
  code: AuditCode;
  confidence: AuditConfidence;
}

export interface TextRepair {
  after: string;
  issues: TextIssue[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…',
  mdash: '—', ndash: '–', copy: '©', reg: '®', trade: '™',
  eacute: 'é', egrave: 'è', agrave: 'à', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú',
  ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç', iuml: 'ï',
};

/** UTF-8 bytes misread as Latin-1, the corruption behind "Trumpâ€™s". Longest first. */
const MOJIBAKE: [string, string][] = [
  ['â€™', '’'], ['â€˜', '‘'], ['â€œ', '“'], ['â€', '”'], ['â€“', '–'], ['â€”', '—'], ['â€¦', '…'],
  ['Ã©', 'é'], ['Ã¨', 'è'], ['Ãª', 'ê'], ['Ã¡', 'á'], ['Ã ', 'à'], ['Ã­', 'í'], ['Ã³', 'ó'], ['Ãº', 'ú'],
  ['Ã±', 'ñ'], ['Ã¼', 'ü'], ['Ã¶', 'ö'], ['Ã¤', 'ä'], ['Ã§', 'ç'], ['Ã¯', 'ï'], ['Ã‰', 'É'], ['Â©', '©'], ['Â®', '®'],
];

const URL_RE = /https?:\/\/[^\s)\]]+/g;

function mapOutsideUrls(text: string, fn: (segment: string) => string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    out += fn(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last));
}

function decodeEntities(segment: string): string {
  return segment.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function decodePercents(segment: string): string {
  return segment.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      const decoded = decodeURIComponent(run);
      return /[\u0000-\u001f\u007f]/.test(decoded) ? run : decoded;
    } catch {
      return run;
    }
  });
}

/**
 * Repairs one prose field. Fixable problems compose into a single `after`;
 * report-only problems (quote mixing, unsupported markup) are listed with no
 * repair implied. `multiline` fields keep line breaks; page bodies keep
 * their Markdown spacing (no double-space collapsing).
 */
export function repairText(value: string, opts: { multiline?: boolean; page?: boolean } = {}): TextRepair {
  const issues = new Map<AuditCode, AuditConfidence>();
  const flag = (code: AuditCode, confidence: AuditConfidence = 'high') => {
    if (!issues.has(code)) issues.set(code, confidence);
  };
  let text = value;

  // Invisible and control characters (tab becomes a space).
  if (/[\uFEFF\u200B-\u200D\u2060\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\t]/.test(text)) {
    flag('CTRL_CHAR');
    text = text.replace(/[\uFEFF\u200B-\u200D\u2060\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\t/g, ' ');
  }

  // Mojibake.
  for (const [bad, good] of MOJIBAKE) {
    if (text.includes(bad)) {
      flag('MOJIBAKE');
      text = text.split(bad).join(good);
    }
  }

  text = mapOutsideUrls(text, (segment) => {
    let out = segment;
    // HTML entities, repeatedly when double-encoded ("&amp;amp;").
    if (/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/.test(out)) {
      flag('ENC_HTML_ENTITY');
      if (/&amp;(amp|lt|gt|quot|apos|#\d+);/i.test(out)) flag('ENC_DOUBLE');
      for (let i = 0; i < 3 && /&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/.test(out); i++) out = decodeEntities(out);
    }
    // Percent-encoding in prose ("%2520" is double-encoded).
    if (/%[0-9A-Fa-f]{2}/.test(out)) {
      if (/%25[0-9A-Fa-f]{2}/.test(out)) flag('ENC_DOUBLE');
      const decoded = decodePercents(decodePercents(out));
      // A lone encoded token with no prose around it may be an identifier; leave it to a human.
      if (decoded !== out && (/\s/.test(out) || /[^\x00-\x7F]/.test(decoded) || /%20/i.test(out))) {
        flag('ENC_PERCENT');
        out = decoded;
      } else if (decoded !== out) {
        flag('ENC_PERCENT', 'medium');
      }
    }
    return out;
  });

  // Literal escape sequences someone pasted instead of the character.
  if (/\\u[0-9a-fA-F]{4}/.test(text)) {
    flag('ESC_UNICODE');
    text = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
  }
  if (/\\["']/.test(text)) {
    flag('ESC_QUOTE');
    text = text.replace(/\\(["'])/g, '$1');
  }
  if (/\\[nrt]/.test(text)) {
    flag('ESC_NEWLINE');
    text = text.replace(/\\r\\n|\\n/g, opts.multiline ? '\n' : ' ').replace(/\\[rt]/g, ' ');
  }

  // Raw HTML: formatting tags become the supported markup or plain text; links become Markdown links.
  if (/<\/?[a-zA-Z][^>]*>/.test(text)) {
    flag('HTML_TAG');
    text = text
      .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
      .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**')
      .replace(/<br\s*\/?>/gi, opts.multiline ? '\n' : ' ')
      .replace(/<\/p>\s*<p[^>]*>/gi, opts.multiline ? '\n\n' : ' ')
      .replace(/<[^>]+>/g, '');
  }

  if (!opts.page) {
    const collapsed = text.replace(/(?<=\S) {2,}(?=\S)/g, ' ').replace(/ +([,.!?;:])/g, '$1');
    if (collapsed !== text) {
      flag('DOUBLE_SPACE');
      text = collapsed;
    }
  }

  // Report-only: quote styles mixed in one field (may be quoted material).
  if (/"/.test(text) && /[“”]/.test(text)) flag('QUOTE_MIX', 'low');
  // Report-only: markup prose fields can't render.
  if (!opts.page && /(^|\n)#{1,6}\s|```|~~/.test(text)) flag('UNSUPPORTED_MARKUP', 'low');

  return { after: text, issues: [...issues.entries()].map(([code, confidence]) => ({ code, confidence })) };
}

// ---------------------------------------------------------------------------
// The audit itself

interface FieldRef {
  type: AuditItemType;
  id: string;
  topicId: string;
  topicTitle: string;
  field: string;
  value: string;
  multiline?: boolean;
  page?: boolean;
  /** Must match a file exactly (OCR or a transcription): problems are reported, never repaired. */
  verbatim?: boolean;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function parseDateMention(text: string): { date: Date; label: string } | undefined {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return { date: new Date(Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!)), label: iso[0] };
  const named = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(text);
  if (named) return { date: new Date(Date.UTC(+named[3]!, MONTHS[named[1]!.toLowerCase()]!, +named[2]!)), label: named[0] };
  const monthYear = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i.exec(text);
  if (monthYear) return { date: new Date(Date.UTC(+monthYear[2]!, MONTHS[monthYear[1]!.toLowerCase()]!, 1)), label: monthYear[0] };
  return undefined;
}

const short = (s: string) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > 90 ? `${flat.slice(0, 89)}…` : flat;
};

export function auditContent(snapshot: ContentSnapshot, options: AuditOptions = {}): AuditReport {
  const categories = new Set<AuditCategory>(options.categories ?? AUDIT_CATEGORIES);
  const status = options.status ?? 'all';
  const staleDays = options.staleDays ?? 90;
  const now = options.now ? new Date(options.now) : new Date();
  const scope = options.ids ? new Set(options.ids) : undefined;

  const topics = snapshot.topics.filter((t) => (!scope || scope.has(t.id)) && (status === 'all' || statusOf(t) === status));
  const topicById = new Map(snapshot.topics.map((t) => [t.id, t]));
  const inScope = (topicId: string) => !scope || scope.has(topicId);
  const byStatus = <T extends { status?: Status }>(items: T[]) => (status === 'all' ? items : items.filter((i) => statusOf(i) === status));
  const referencesAll = snapshot.references.filter((r) => inScope(r.topicId));
  const perspectivesAll = snapshot.perspectives.filter((p) => inScope(p.topicId));
  const relationsAll = snapshot.relations.filter((r) => inScope(r.fromId) || inScope(r.toId));
  const attachmentsAll = (snapshot.attachments ?? []).filter((a) => inScope(a.topicId));
  const references = byStatus(referencesAll);
  const perspectives = byStatus(perspectivesAll);
  const relations = byStatus(relationsAll);
  const attachments = byStatus(attachmentsAll);
  const outlets = scope ? [] : (snapshot.outlets ?? []);
  const pages = scope ? [] : (snapshot.pages ?? []);

  const findings: AuditFinding[] = [];
  const push = (f: Omit<AuditFinding, 'line'>) => {
    const shown = f.before !== undefined ? ` | ${short(f.before)}${f.after !== undefined ? ` → ${short(f.after)}` : ''}` : ` | ${short(f.message)}`;
    findings.push({ ...f, line: `${f.topicId} | ${f.type}:${f.id} | ${f.field} | ${f.code} ${f.confidence}${shown}` });
  };

  // -- text ---------------------------------------------------------------
  const fields: FieldRef[] = [];
  const add = (f: FieldRef) => {
    if (f.value) fields.push(f);
  };
  for (const t of topics) {
    const base = { type: 'topic' as const, id: t.id, topicId: t.id, topicTitle: t.title };
    add({ ...base, field: 'title', value: t.title });
    add({ ...base, field: 'summary', value: t.summary, multiline: true });
    add({ ...base, field: 'disputed', value: t.disputed });
    add({ ...base, field: 'notes', value: t.notes, multiline: true });
    t.tags.forEach((tag, i) => add({ ...base, field: `tags.${i}`, value: tag }));
    t.sections.forEach((s, si) => {
      add({ ...base, field: `sections.${si}.label`, value: s.label });
      s.points.forEach((p, pi) => add({ ...base, field: `sections.${si}.points.${pi}.text`, value: p.text, multiline: true }));
    });
  }
  for (const r of references) {
    const base = { type: 'reference' as const, id: r.id, topicId: r.topicId, topicTitle: topicById.get(r.topicId)?.title ?? r.topicId };
    add({ ...base, field: 'label', value: r.label });
    add({ ...base, field: 'excerpt', value: r.excerpt ?? '', multiline: true });
    add({ ...base, field: 'note', value: r.note ?? '' });
  }
  for (const p of perspectives) {
    const base = { type: 'perspective' as const, id: p.id, topicId: p.topicId, topicTitle: topicById.get(p.topicId)?.title ?? p.topicId };
    add({ ...base, field: 'holder', value: p.holder });
    add({ ...base, field: 'body', value: p.body, multiline: true });
  }
  for (const r of relations) {
    add({ type: 'relation', id: r.id, topicId: r.fromId, topicTitle: topicById.get(r.fromId)?.title ?? r.fromId, field: 'note', value: r.note });
  }
  for (const a of attachments) {
    const base = { type: 'attachment' as const, id: a.id, topicId: a.topicId, topicTitle: topicById.get(a.topicId)?.title ?? a.topicId };
    add({ ...base, field: 'caption', value: a.caption });
    add({ ...base, field: 'altText', value: a.altText });
    // OCR output and transcriptions are evidence of what a file says; damage here is flagged, not "fixed".
    add({ ...base, field: 'extractedText', value: a.extractedText ?? '', multiline: true, verbatim: true });
  }
  for (const o of outlets) {
    const base = { type: 'outlet' as const, id: o.id, topicId: o.id, topicTitle: o.name };
    add({ ...base, field: 'name', value: o.name });
    add({ ...base, field: 'note', value: o.note ?? '' });
  }
  for (const p of pages) {
    const base = { type: 'page' as const, id: p.id, topicId: p.id, topicTitle: p.id };
    add({ ...base, field: 'draft.title', value: p.draft.title });
    add({ ...base, field: 'draft.body', value: p.draft.body, multiline: true, page: true });
  }

  if (categories.has('text')) {
    for (const f of fields) {
      const repair = repairText(f.value, { multiline: f.multiline, page: f.page });
      const changed = repair.after !== f.value;
      for (const issue of repair.issues) {
        const fixable = changed && issue.confidence === 'high' && !f.verbatim;
        push({
          category: 'text', code: issue.code, confidence: issue.confidence,
          type: f.type, id: f.id, topicId: f.topicId, topicTitle: f.topicTitle, field: f.field,
          before: f.value, ...(fixable ? { after: repair.after } : {}),
          message: fixable ? 'Repair available' : f.verbatim ? 'Extracted text must match the file; check it against the original' : 'Needs a human look',
        });
      }
    }
  }

  // -- structure ------------------------------------------------------------
  if (categories.has('structure')) {
    const cited = new Set<string>();
    for (const t of snapshot.topics) for (const s of t.sections) for (const p of s.points) for (const id of p.refIds) cited.add(id);
    for (const p of snapshot.perspectives) for (const id of p.refIds) cited.add(id);

    for (const t of topics) {
      if (t.kind !== 'thesis') {
        t.sections.forEach((s, si) =>
          s.points.forEach((p, pi) => {
            if (p.refIds.length === 0) {
              push({
                category: 'structure', code: 'POINT_NO_CITATION', confidence: 'medium',
                type: 'topic', id: t.id, topicId: t.id, topicTitle: t.title,
                field: `sections.${si}.points.${pi}.text`, before: p.text,
                message: 'Point cites no reference',
              });
            }
          }),
        );
      }
      const mine = perspectives.filter((p) => p.topicId === t.id);
      for (let i = 0; i < mine.length; i++) {
        for (let j = i + 1; j < mine.length; j++) {
          const sim = similarity(mine[i]!.body, mine[j]!.body);
          if (sim >= 0.85) {
            push({
              category: 'structure', code: 'PERSPECTIVE_NEAR_DUP', confidence: 'medium',
              type: 'perspective', id: mine[j]!.id, topicId: t.id, topicTitle: t.title, field: 'body',
              before: mine[j]!.body,
              message: `Near-duplicate of perspective ${mine[i]!.id} (${mine[i]!.holder} / ${mine[i]!.stance}), similarity ${sim.toFixed(2)}`,
            });
          }
        }
      }
      if (statusOf(t) === 'published') {
        const draftChild = (type: AuditItemType, id: string, field: string, what: string) =>
          push({
            category: 'structure', code: 'PUBLISHED_WITH_DRAFT_CHILD', confidence: 'medium',
            type, id, topicId: t.id, topicTitle: t.title, field,
            message: `Published topic has a draft ${what} that readers cannot see`,
          });
        for (const r of referencesAll) if (r.topicId === t.id && statusOf(r) === 'draft') draftChild('reference', r.id, 'label', 'reference');
        for (const p of perspectivesAll) if (p.topicId === t.id && statusOf(p) === 'draft') draftChild('perspective', p.id, 'body', 'perspective');
        for (const a of attachmentsAll) if (a.topicId === t.id && statusOf(a) === 'draft') draftChild('attachment', a.id, 'caption', 'attachment');
        for (const r of relationsAll) {
          if ((r.fromId === t.id || r.toId === t.id) && statusOf(r) === 'draft') draftChild('relation', r.id, 'note', 'link');
        }
      }
    }
    for (const r of references) {
      if (!cited.has(r.id)) {
        push({
          category: 'structure', code: 'REF_ORPHAN', confidence: 'medium',
          type: 'reference', id: r.id, topicId: r.topicId, topicTitle: topicById.get(r.topicId)?.title ?? r.topicId,
          field: 'label', before: r.label, message: 'No point or perspective cites this reference',
        });
      }
    }
  }

  // -- staleness --------------------------------------------------------------
  if (categories.has('staleness')) {
    for (const t of topics) {
      const checks: [string, string][] = [
        ['title', t.title], ['summary', t.summary], ['disputed', t.disputed], ['notes', t.notes],
      ];
      for (const [field, value] of checks) {
        if (!value) continue;
        const mention = parseDateMention(value);
        const pending = /\b(pending|awaiting|yet to|still to come|upcoming|scheduled|trial|hearing|sentencing)\b/i.exec(value);
        let stale: string | undefined;
        if (mention && /\bas of\b|\btrial\b|\bhearing\b|\bscheduled\b|\bsentencing\b/i.test(value)) {
          const age = Math.floor((now.getTime() - mention.date.getTime()) / 86_400_000);
          if (age > staleDays) stale = `"${mention.label}" was ${age} days ago`;
        } else if (!mention && pending) {
          const age = Math.floor((now.getTime() - new Date(t.updatedAt).getTime()) / 86_400_000);
          if (age > staleDays) stale = `"${pending[0]}" language and the entry is ${age} days untouched`;
        }
        if (stale) {
          push({
            category: 'staleness', code: 'STALE_DATE', confidence: 'low',
            type: 'topic', id: t.id, topicId: t.id, topicTitle: t.title, field,
            before: value, message: `Possibly stale: ${stale}`,
          });
        }
      }
    }
  }

  const counts: Partial<Record<AuditCode, number>> = {};
  for (const f of findings) counts[f.code] = (counts[f.code] ?? 0) + 1;
  return {
    scanned: {
      topics: topics.length, references: references.length, perspectives: perspectives.length,
      relations: relations.length, outlets: outlets.length, attachments: attachments.length, pages: pages.length, fields: fields.length,
    },
    total: findings.length,
    counts,
    findings,
  };
}

/** Jaccard similarity of two texts' word sets, for spotting restated perspectives. */
function similarity(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
}
