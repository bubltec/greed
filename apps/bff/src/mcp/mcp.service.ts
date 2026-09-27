import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { isPageId, type PageId, statusOf, type TopicView } from '@greed/domain';
import { ContentService } from '../content/content.service.js';
import {
  PageInputDto,
  PerspectiveInputDto,
  ReferenceInputDto,
  RelationInputDto,
  SetStatusDto,
  TopicInputDto,
} from '../content/content.dto.js';
import { TOOLS, type ToolDefinition } from './mcp.tools.js';

type Args = Record<string, unknown>;

/**
 * Tool implementations. Every write goes through ContentService and the same
 * DTO validation as the web CMS, so the integrity rules can't be bypassed.
 * Everything the connector creates starts as a draft; only the explicit
 * publish tools make content public.
 */
@Injectable()
export class McpService {
  constructor(private readonly content: ContentService) {}

  listTools(): ToolDefinition[] {
    return TOOLS;
  }

  async call(name: string, args: Args, by: string): Promise<unknown> {
    switch (name) {
      case 'search_topics':
        return this.search(args);
      case 'get_topic':
        return this.content.view(requireString(args, 'id'), true);
      case 'find_gaps':
        return this.gaps();
      case 'create_topic': {
        const input = await dto(TopicInputDto, {
          status: 'draft',
          kind: 'case',
          sections: [],
          disputed: '',
          notes: '',
          tags: [],
          ...pick(args, ['kind', 'title', 'summary', 'sections', 'disputed', 'notes', 'tags']),
        });
        return compact(await this.content.createTopic(input, by));
      }
      case 'update_topic': {
        const current = await this.content.view(requireString(args, 'id'), true);
        const { topic } = current;
        const input = await dto(TopicInputDto, {
          kind: topic.kind,
          title: topic.title,
          summary: topic.summary,
          sections: topic.sections,
          disputed: topic.disputed,
          notes: topic.notes,
          tags: topic.tags,
          ...pick(args, ['kind', 'title', 'summary', 'sections', 'disputed', 'notes', 'tags']),
        });
        return compact(await this.content.updateTopic(topic.id, input, by));
      }
      case 'add_points': {
        const { topic } = await this.content.view(requireString(args, 'topicId'), true);
        const label = requireString(args, 'sectionLabel');
        const added = (Array.isArray(args.points) ? args.points : []).map((p) => ({
          text: (p as Args).text,
          refIds: (p as Args).refIds ?? [],
        }));
        if (added.length === 0) throw new BadRequestException('points must not be empty');
        const sections = topic.sections.some((s) => s.label === label)
          ? topic.sections.map((s) => (s.label === label ? { ...s, points: [...s.points, ...added] } : s))
          : [...topic.sections, { label, points: added }];
        const input = await dto(TopicInputDto, { ...topic, sections, id: undefined, createdAt: undefined, updatedAt: undefined, updatedBy: undefined });
        return compact(await this.content.updateTopic(topic.id, input, by));
      }
      case 'add_reference': {
        const view = await this.content.saveReference(
          requireString(args, 'topicId'),
          undefined,
          await dto(ReferenceInputDto, { status: 'draft', ...pick(args, ['label', 'url', 'publishedOn', 'excerpt', 'note']) }),
          by,
        );
        return { ...compact(view), added: view.references.at(-1) };
      }
      case 'update_reference':
        return compact(
          await this.content.saveReference(
            requireString(args, 'topicId'),
            requireString(args, 'referenceId'),
            await dto(ReferenceInputDto, pick(args, ['label', 'url', 'publishedOn', 'excerpt', 'note'])),
            by,
          ),
        );
      case 'add_perspective':
        return compact(
          await this.content.savePerspective(
            requireString(args, 'topicId'),
            undefined,
            await dto(PerspectiveInputDto, { status: 'draft', refIds: [], ...pick(args, ['stance', 'holder', 'body', 'refIds']) }),
            by,
          ),
        );
      case 'link_topics':
        return this.content.saveRelation(
          undefined,
          await dto(RelationInputDto, {
            status: 'draft',
            provenance: 'inferred',
            ...pick(args, ['fromId', 'toId', 'kind', 'note', 'provenance']),
          }),
          by,
        );
      case 'list_drafts':
        return { drafts: (await this.content.index(true)).drafts() };
      case 'publish_topic':
        return compact(
          await this.content.publishTopic(requireString(args, 'topicId'), args.includeChildren !== false, by),
        );
      case 'set_status':
        return this.content.setStatus(await dto(SetStatusDto, pick(args, ['status', 'items'])), by);
      case 'get_page':
        return this.content.page(pageId(args), true);
      case 'update_page':
        return this.content.savePage(pageId(args), await dto(PageInputDto, pick(args, ['title', 'body'])), by);
      case 'publish_page':
        return this.content.publishPage(pageId(args), by);
      case 'unlink_topics':
        await this.content.deleteRelation(requireString(args, 'relationId'));
        return { deleted: args.relationId };
      default:
        throw new BadRequestException(`Unknown tool: ${name}`);
    }
  }

  private async search(args: Args) {
    const words = (typeof args.query === 'string' ? args.query : '').toLowerCase().split(/\s+/).filter(Boolean);
    const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
    const all = (await this.content.index(true)).summaries();
    const hits = all.filter((t) => {
      if (typeof args.kind === 'string' && t.kind !== args.kind) return false;
      const hay = `${t.id} ${t.title} ${t.summary} ${t.tags.join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    return { total: hits.length, topics: hits.slice(0, limit).map(({ summary, ...rest }) => ({ ...rest, summary: summary.slice(0, 300) })) };
  }

  private async gaps() {
    const { snapshot } = await this.content.index(true);
    const title = new Map(snapshot.topics.map((t) => [t.id, t.title]));
    const linked = new Set(snapshot.relations.flatMap((r) => [r.fromId, r.toId]));
    const withPerspective = new Set(snapshot.perspectives.map((p) => p.topicId));
    const withRefs = new Set(snapshot.references.map((r) => r.topicId));
    const topic = (id: string) => ({ id, title: title.get(id) ?? id });
    return {
      draftsAwaitingReview: (await this.content.index(true)).drafts().length,
      sourcesMissingUrl: snapshot.references
        .filter((r) => !r.url)
        .map((r) => ({ topicId: r.topicId, referenceId: r.id, label: r.label })),
      topicsWithoutPerspectives: snapshot.topics.filter((t) => !withPerspective.has(t.id)).map((t) => topic(t.id)),
      topicsWithoutLinks: snapshot.topics.filter((t) => !linked.has(t.id)).map((t) => topic(t.id)),
      topicsWithoutSources: snapshot.topics
        .filter((t) => !withRefs.has(t.id) && t.kind !== 'thesis')
        .map((t) => topic(t.id)),
    };
  }
}

/** Trimmed view for write results: enough to chain calls, without re-sending everything. */
function compact(view: TopicView) {
  return {
    id: view.topic.id,
    title: view.topic.title,
    status: statusOf(view.topic),
    url: `/t/${view.topic.id}`,
    sections: view.topic.sections.map((s) => ({ label: s.label, points: s.points.length })),
    references: view.references.map((r) => ({ id: r.id, label: r.label, url: r.url, status: statusOf(r) })),
    perspectives: view.perspectives.map((p) => ({ id: p.id, stance: p.stance, holder: p.holder, status: statusOf(p) })),
    related: view.related.map((r) => ({
      relationId: r.relation.id,
      kind: r.relation.kind,
      topicId: r.other.id,
      status: statusOf(r.relation),
    })),
  };
}

function pick(args: Args, keys: string[]): Args {
  return Object.fromEntries(keys.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
}

function pageId(args: Args): PageId {
  if (!isPageId(args.id)) throw new BadRequestException('id must be "home" or "about"');
  return args.id;
}

function requireString(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v) throw new BadRequestException(`${key} is required`);
  return v;
}

async function dto<T extends object>(cls: new () => T, plain: Args): Promise<T> {
  const clean = Object.fromEntries(Object.entries(plain).filter(([, v]) => v !== undefined));
  const instance = plainToInstance(cls, clean);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    const flat = (e: (typeof errors)[number], path = ''): string[] => [
      ...Object.values(e.constraints ?? {}).map((m) => `${path}${m}`),
      ...(e.children ?? []).flatMap((c) => flat(c, `${path}${e.property}.`)),
    ];
    throw new BadRequestException(errors.flatMap((e) => flat(e)).join('; '));
  }
  return instance;
}
