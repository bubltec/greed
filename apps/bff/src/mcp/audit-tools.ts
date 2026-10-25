import {
  AUDIT_CATEGORIES,
  AUDIT_CODES,
  auditContent,
  type AuditCategory,
  type AuditCode,
  type AuditFinding,
  type EntityName,
  type Status,
} from '@greed/domain';
import { BadRequestException } from '@nestjs/common';
import type { ContentService } from '../content/content.service.js';
import { ENTITIES } from '../content/entities/index.js';
import { type Args, dto, optionalString } from './args.js';
import { currentInput } from './crud-tools.js';
import type { Tool } from './tool.js';

interface AuditArgs {
  ids?: string[];
  categories?: AuditCategory[];
  codes?: AuditCode[];
  status?: Status | 'all';
  staleDays?: number;
}

/**
 * Bulk audit tools. `audit_content` is a read-only dry run that returns one
 * compact line per issue (never full entries, so auditing every topic does
 * not swamp the caller's context); `apply_audit_fixes` recomputes the audit
 * server-side and writes only the high-confidence text repairs, through
 * ContentService like every other write. Structure and staleness findings
 * are never auto-fixed.
 */
export function auditTools(content: ContentService): Tool[] {
  return [
    {
      definition: {
        name: 'audit_content',
        title: 'Audit content',
        description:
          'Audit topics (or every entry, outlets and pages included, when ids is omitted) for text damage ' +
          '(HTML entities, percent-encoding, literal \\n and \\" escapes, mojibake, raw HTML, doubled spaces), ' +
          'structure problems (points citing nothing, references nothing cites, near-duplicate perspectives, published topics with draft sources or links) ' +
          'and stale "as of"/pending language. Returns one line per issue with the topic id, field, and a before → after repair where one is safe; ' +
          'page through with offset. Writes nothing.',
        inputSchema: {
          type: 'object',
          properties: {
            ids: { type: 'array', items: { type: 'string' }, description: 'Topic ids to audit; omit to audit everything.' },
            categories: { type: 'array', items: { type: 'string', enum: AUDIT_CATEGORIES }, description: 'Default: all three.' },
            codes: { type: 'array', items: { type: 'string', enum: AUDIT_CODES }, description: 'Only these issue codes.' },
            status: { type: 'string', enum: ['draft', 'published', 'all'], description: 'Default all.' },
            staleDays: { type: 'number', description: 'Days before dated/pending language counts as stale. Default 90.' },
            limit: { type: 'number', description: 'Findings per call. Default 50, max 200.' },
            offset: { type: 'number', description: 'Findings to skip; use nextOffset from the previous call.' },
          },
        },
        annotations: { readOnlyHint: true },
      },
      run: async (args) => {
        const parsed = auditArgs(args);
        const limit = clamp(args.limit, 50, 1, 200);
        const offset = clamp(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);
        const report = await runAudit(content, parsed);
        const page = report.findings.slice(offset, offset + limit);
        return {
          scanned: report.scanned,
          total: report.total,
          counts: report.counts,
          offset,
          nextOffset: offset + page.length < report.total ? offset + page.length : null,
          lines: page.map((f) => f.line),
        };
      },
    },
    {
      definition: {
        name: 'apply_audit_fixes',
        title: 'Apply audit fixes',
        description:
          'Apply the high-confidence text repairs from audit_content (decoded entities, unescaped text, repaired mojibake, stripped control characters, ' +
          'collapsed spaces) without changing any item’s status. The audit is recomputed here, so stale or invented repairs are never written. ' +
          'Structure and staleness findings are skipped, never auto-fixed. Returns one line per repaired field; run audit_content afterwards to see what remains.',
        inputSchema: {
          type: 'object',
          properties: {
            ids: { type: 'array', items: { type: 'string' }, description: 'Topic ids to fix; omit to fix everything.' },
            codes: { type: 'array', items: { type: 'string', enum: AUDIT_CODES }, description: 'Only these issue codes. Default: all repairable ones.' },
            status: { type: 'string', enum: ['draft', 'published', 'all'], description: 'Default all.' },
            limit: { type: 'number', description: 'Fields to repair this call. Default 50, max 200.' },
          },
        },
        annotations: { idempotentHint: true },
      },
      run: async (args, by) => applyFixes(content, auditArgs(args), clamp(args.limit, 50, 1, 200), by),
    },
  ];
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (value === undefined || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function auditArgs(args: Args): AuditArgs {
  const status = optionalString(args, 'status');
  if (status !== undefined && !['draft', 'published', 'all'].includes(status)) {
    throw new BadRequestException('status must be draft, published or all');
  }
  return {
    ids: stringArray(args, 'ids'),
    categories: enumArray<AuditCategory>(args, 'categories', AUDIT_CATEGORIES),
    codes: enumArray<AuditCode>(args, 'codes', AUDIT_CODES),
    status: status as AuditArgs['status'],
    staleDays: args.staleDays === undefined ? undefined : clamp(args.staleDays, 90, 0, 3650),
  };
}

function stringArray(args: Args, key: string): string[] | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x)) throw new BadRequestException(`${key} must be an array of ids`);
  return v as string[];
}

function enumArray<T extends string>(args: Args, key: string, allowed: readonly T[]): T[] | undefined {
  const values = stringArray(args, key);
  if (values === undefined) return undefined;
  const bad = values.filter((v) => !(allowed as readonly string[]).includes(v));
  if (bad.length) throw new BadRequestException(`${key} must be chosen from ${allowed.join(', ')}`);
  return values as T[];
}

async function runAudit(content: ContentService, args: AuditArgs) {
  const { snapshot } = await content.index(true);
  const report = auditContent(snapshot, args);
  if (!args.codes) return report;
  const wanted = new Set(args.codes);
  const findings = report.findings.filter((f) => wanted.has(f.code));
  const counts: typeof report.counts = {};
  for (const f of findings) counts[f.code] = (counts[f.code] ?? 0) + 1;
  return { ...report, findings, total: findings.length, counts };
}

/** Sets one field (dotted path) on a DTO-shaped input built from the stored item. */
function setField(input: Args, field: string, value: string): boolean {
  const parts = field.split('.');
  let target: unknown = input;
  for (const part of parts.slice(0, -1)) {
    if (Array.isArray(target)) target = target[Number(part)];
    else if (target && typeof target === 'object') target = (target as Args)[part];
    else return false;
  }
  const last = parts[parts.length - 1]!;
  if (Array.isArray(target)) {
    const i = Number(last);
    if (!Number.isInteger(i) || i < 0 || i >= target.length || typeof target[i] !== 'string') return false;
    target[i] = value;
    return true;
  }
  if (target && typeof target === 'object' && typeof (target as Args)[last] === 'string') {
    (target as Args)[last] = value;
    return true;
  }
  return false;
}

async function applyFixes(content: ContentService, args: AuditArgs, limit: number, by: string) {
  const report = await runAudit(content, { ...args, categories: ['text'] });
  // One repair per field (several findings on one field share the same repaired value).
  const byField = new Map<string, AuditFinding>();
  for (const f of report.findings) {
    if (f.after !== undefined && f.confidence === 'high') byField.set(`${f.type}:${f.id}:${f.field}`, f);
  }
  const queue = [...byField.values()].slice(0, limit);

  // Group by item so each item is written once, however many fields changed.
  const groups = new Map<string, AuditFinding[]>();
  for (const f of queue) {
    const key = `${f.type}:${f.id}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  const fixed: string[] = [];
  const skipped: string[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    const type = first.type as EntityName;
    try {
      const spec = ENTITIES[type];
      const item = await content.find(type, first.id);
      const input = currentInput(spec, item);
      // Pages are edited through their working copy: audit fields are draft.title/draft.body.
      const applied = group.filter((f) => setField(input, type === 'page' ? f.field.replace(/^draft\./, '') : f.field, f.after!));
      if (applied.length === 0) throw new Error('field no longer matches the audit');
      const parentId = type === 'reference' || type === 'perspective' ? first.topicId : undefined;
      await content.update(type, { id: first.id, parentId }, await dto(spec.dto, input), by);
      for (const f of applied) fixed.push(`fixed ${f.line}`);
      for (const f of group) if (!applied.includes(f)) skipped.push(`skipped ${f.line} (field changed since audit)`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      for (const f of group) skipped.push(`skipped ${f.line} (${reason})`);
    }
  }

  const remaining = await runAudit(content, { ...args, categories: ['text'] });
  const remainingFixable = new Set(
    remaining.findings.filter((f) => f.after !== undefined && f.confidence === 'high').map((f) => `${f.type}:${f.id}:${f.field}`),
  ).size;
  return { fixed, skipped, remainingFixable, remainingTotal: remaining.total };
}
