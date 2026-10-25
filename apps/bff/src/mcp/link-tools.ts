import { statusOf } from '@greed/domain';
import { BadRequestException } from '@nestjs/common';
import type { ContentService } from '../content/content.service.js';
import { type LinkCode, LINK_CODES, checkLinks } from '../links/check.js';
import type { Probe } from '../links/probe.js';
import { type Args, optionalString } from './args.js';
import type { Tool } from './tool.js';

const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Number(value);
  return value === undefined || !Number.isFinite(n) ? fallback : Math.min(Math.max(Math.trunc(n), min), max);
};

function ids(args: Args): string[] | undefined {
  const v = args.ids;
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x)) throw new BadRequestException('ids must be an array of ids');
  return v as string[];
}

/**
 * `audit_links`: do the URLs cited by references still work. The one place the server dials an
 * address an editor typed, so it is bounded (see links/): only URLs already on a reference,
 * http(s) on ports 80 and 443, public addresses only, headers read and never a body, at most
 * three redirects each vetted, a time budget per call. It reports; it never edits a reference.
 */
export function linkTools(content: ContentService, probe: Probe): Tool[] {
  return [
    {
      definition: {
        name: 'audit_links',
        title: 'Check that cited links still work',
        description:
          'Check the URLs on references: dead pages (404/410, domain gone), moved pages (with the new address), servers that block automated checks, ' +
          'server errors and cited paywalled outlets. One line per problem with the topic id and reference id; healthy links are only counted. ' +
          'Only URLs already cited on a reference are requested, never one you pass in, and no page body is read. Writes nothing: fix a moved link with update_reference. ' +
          'Checks about 25 links per call within a time budget; page with offset (nextOffset is null when done). A "blocked" link is not proof it is broken.',
        inputSchema: {
          type: 'object',
          properties: {
            ids: { type: 'array', items: { type: 'string' }, description: 'Topic ids whose references to check; omit for every reference.' },
            status: { type: 'string', enum: ['draft', 'published', 'all'], description: 'Reference status. Default all.' },
            codes: { type: 'array', items: { type: 'string', enum: LINK_CODES }, description: 'Only report these codes.' },
            limit: { type: 'number', description: 'Distinct URLs per call. Default 25, max 40.' },
            offset: { type: 'number', description: 'Distinct URLs to skip; use nextOffset from the previous call.' },
          },
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      run: async (args) => {
        const status = optionalString(args, 'status') ?? 'all';
        if (!['draft', 'published', 'all'].includes(status)) throw new BadRequestException('status must be draft, published or all');
        const wanted = args.codes === undefined ? undefined : codes(args.codes);
        const scope = ids(args);
        const limit = clamp(args.limit, 25, 1, 40);
        const offset = clamp(args.offset, 0, 0, Number.MAX_SAFE_INTEGER);

        const { snapshot } = await content.index(true);
        const refs = snapshot.references
          .filter((r) => r.url && (!scope || scope.includes(r.topicId)) && (status === 'all' || statusOf(r) === status))
          .sort((a, b) => a.topicId.localeCompare(b.topicId) || a.id.localeCompare(b.id));
        // One request per distinct URL, however many references cite it.
        const byUrl = new Map<string, typeof refs>();
        for (const r of refs) byUrl.set(r.url!, [...(byUrl.get(r.url!) ?? []), r]);
        const urls = [...byUrl.keys()];

        const results = await checkLinks(urls.slice(offset, offset + limit), probe, { outlets: snapshot.outlets ?? [] });
        const counts: Partial<Record<LinkCode, number>> = {};
        const lines: string[] = [];
        let healthy = 0;
        for (const result of results) {
          if (!result.code) {
            healthy += byUrl.get(result.url)!.length;
            continue;
          }
          for (const r of byUrl.get(result.url)!) {
            counts[result.code] = (counts[result.code] ?? 0) + 1;
            if (wanted && !wanted.includes(result.code)) continue;
            const to = result.finalUrl ? ` → ${result.finalUrl}` : '';
            lines.push(`${r.topicId} | reference:${r.id} | ${result.code} ${result.confidence} | ${result.detail} | ${result.url}${to}`);
          }
        }
        const reached = offset + results.length;
        return {
          checked: results.length,
          totalUrls: urls.length,
          healthy,
          counts,
          offset,
          nextOffset: reached < urls.length ? reached : null,
          lines,
        };
      },
    },
  ];
}

function codes(value: unknown): LinkCode[] {
  if (!Array.isArray(value) || value.some((c) => !(LINK_CODES as readonly unknown[]).includes(c))) {
    throw new BadRequestException(`codes must be chosen from ${LINK_CODES.join(', ')}`);
  }
  return value as LinkCode[];
}
