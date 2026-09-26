import type {
  ContentSnapshot,
  Perspective,
  Reference,
  Relation,
  Topic,
  TopicKind,
} from './entities.js';

export interface TopicSummary {
  id: string;
  kind: TopicKind;
  title: string;
  summary: string;
  tags: string[];
  disputed: boolean;
  updatedAt: string;
  counts: { references: number; perspectives: number; relations: number };
}

export interface RelatedTopic {
  relation: Relation;
  /** The topic on the other end; `direction` says which end this topic is. */
  other: Pick<Topic, 'id' | 'title' | 'kind'>;
  direction: 'outgoing' | 'incoming';
}

export interface TopicView {
  topic: Topic;
  references: Reference[];
  perspectives: Perspective[];
  related: RelatedTopic[];
}

export interface GraphView {
  nodes: { id: string; title: string; kind: TopicKind; degree: number }[];
  edges: { id: string; from: string; to: string; kind: Relation['kind'] }[];
}

export interface ActivityEntry {
  type: 'topic' | 'reference' | 'perspective' | 'relation';
  id: string;
  topicId: string;
  topicTitle: string;
  label: string;
  updatedAt: string;
  updatedBy?: string;
}

/** Indexes a snapshot once so each view is a lookup, not a scan. */
export class ContentIndex {
  readonly topicsById = new Map<string, Topic>();
  private readonly refsByTopic = new Map<string, Reference[]>();
  private readonly perspectivesByTopic = new Map<string, Perspective[]>();
  private readonly relationsByTopic = new Map<string, Relation[]>();

  constructor(readonly snapshot: ContentSnapshot) {
    for (const t of snapshot.topics) this.topicsById.set(t.id, t);
    for (const r of snapshot.references) push(this.refsByTopic, r.topicId, r);
    for (const p of snapshot.perspectives) push(this.perspectivesByTopic, p.topicId, p);
    for (const rel of snapshot.relations) {
      // A relation whose other end was deleted is invisible, not an error.
      if (!this.topicsById.has(rel.fromId) || !this.topicsById.has(rel.toId)) continue;
      push(this.relationsByTopic, rel.fromId, rel);
      if (rel.toId !== rel.fromId) push(this.relationsByTopic, rel.toId, rel);
    }
  }

  summaries(): TopicSummary[] {
    return this.snapshot.topics
      .map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        summary: t.summary,
        tags: t.tags,
        disputed: t.disputed.trim().length > 0,
        updatedAt: t.updatedAt,
        counts: {
          references: this.refsByTopic.get(t.id)?.length ?? 0,
          perspectives: this.perspectivesByTopic.get(t.id)?.length ?? 0,
          relations: this.relationsByTopic.get(t.id)?.length ?? 0,
        },
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  view(topicId: string): TopicView | undefined {
    const topic = this.topicsById.get(topicId);
    if (!topic) return undefined;
    const related = (this.relationsByTopic.get(topicId) ?? []).map((relation) => {
      const outgoing = relation.fromId === topicId;
      const other = this.topicsById.get(outgoing ? relation.toId : relation.fromId)!;
      return {
        relation,
        other: { id: other.id, title: other.title, kind: other.kind },
        direction: outgoing ? ('outgoing' as const) : ('incoming' as const),
      };
    });
    related.sort((a, b) => a.other.title.localeCompare(b.other.title));
    return {
      topic,
      references: [...(this.refsByTopic.get(topicId) ?? [])].sort(byCreated),
      perspectives: [...(this.perspectivesByTopic.get(topicId) ?? [])].sort(byCreated),
      related,
    };
  }

  graph(): GraphView {
    const edges = this.snapshot.relations
      .filter((r) => this.topicsById.has(r.fromId) && this.topicsById.has(r.toId))
      .map((r) => ({ id: r.id, from: r.fromId, to: r.toId, kind: r.kind }));
    return {
      nodes: this.snapshot.topics.map((t) => ({
        id: t.id,
        title: t.title,
        kind: t.kind,
        degree: this.relationsByTopic.get(t.id)?.length ?? 0,
      })),
      edges,
    };
  }

  activity(limit = 25): ActivityEntry[] {
    const title = (id: string) => this.topicsById.get(id)?.title ?? id;
    const entries: ActivityEntry[] = [
      ...this.snapshot.topics.map((t) => ({
        type: 'topic' as const,
        id: t.id,
        topicId: t.id,
        topicTitle: t.title,
        label: t.title,
        updatedAt: t.updatedAt,
        updatedBy: t.updatedBy,
      })),
      ...this.snapshot.references.map((r) => ({
        type: 'reference' as const,
        id: r.id,
        topicId: r.topicId,
        topicTitle: title(r.topicId),
        label: r.label,
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy,
      })),
      ...this.snapshot.perspectives.map((p) => ({
        type: 'perspective' as const,
        id: p.id,
        topicId: p.topicId,
        topicTitle: title(p.topicId),
        label: p.holder,
        updatedAt: p.updatedAt,
        updatedBy: p.updatedBy,
      })),
      ...this.snapshot.relations
        .filter((r) => this.topicsById.has(r.fromId))
        .map((r) => ({
          type: 'relation' as const,
          id: r.id,
          topicId: r.fromId,
          topicTitle: title(r.fromId),
          label: `→ ${title(r.toId)}`,
          updatedAt: r.updatedAt,
          updatedBy: r.updatedBy,
        })),
    ];
    return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function byCreated(a: { createdAt: string }, b: { createdAt: string }) {
  return a.createdAt.localeCompare(b.createdAt);
}
