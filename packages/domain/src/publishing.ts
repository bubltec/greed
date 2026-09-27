import { type ContentSnapshot, statusOf } from './entities.js';

const published = (x: { status?: 'draft' | 'published' }) => statusOf(x) === 'published';

/**
 * Editors are recorded by email so the CMS knows who changed what; the public
 * site only ever says "editor". System writers ("import", "link-fill") stay.
 */
export const publicAuthor = (by: string | undefined): string | undefined =>
  by?.includes('@') ? 'editor' : by;
const anon = <T extends { updatedBy?: string }>(x: T): T =>
  x.updatedBy?.includes('@') ? { ...x, updatedBy: publicAuthor(x.updatedBy) } : x;

/**
 * What the public sees: published rows only. A reference, perspective or link
 * also needs its topic(s) published, and citations of draft references are
 * dropped so a published point never shows a footnote to something hidden.
 */
export function publishedOnly(snapshot: ContentSnapshot): ContentSnapshot {
  const topics = snapshot.topics.filter(published);
  const topicIds = new Set(topics.map((t) => t.id));
  const references = snapshot.references.filter((r) => published(r) && topicIds.has(r.topicId));
  const refIds = new Set(references.map((r) => r.id));
  const keepRefs = (ids: string[]) => ids.filter((id) => refIds.has(id));
  return {
    topics: topics.map((t) => ({
      ...anon(t),
      sections: t.sections.map((s) => ({
        ...s,
        points: s.points.map((p) => ({ ...p, refIds: keepRefs(p.refIds) })),
      })),
    })),
    references: references.map(anon),
    perspectives: snapshot.perspectives
      .filter((p) => published(p) && topicIds.has(p.topicId))
      .map((p) => ({ ...anon(p), refIds: keepRefs(p.refIds) })),
    relations: snapshot.relations
      .filter((r) => published(r) && topicIds.has(r.fromId) && topicIds.has(r.toId))
      .map(anon),
    // Only the published copy of a page is public; working copies stay with editors.
    pages: (snapshot.pages ?? [])
      .filter((p) => p.published)
      .map((p) => {
        const pub = { ...p.published!, publishedBy: publicAuthor(p.published!.publishedBy) };
        return { id: p.id, draft: { ...pub, updatedAt: pub.publishedAt }, published: pub };
      }),
  };
}

export type ItemType = 'topic' | 'reference' | 'perspective' | 'relation';

export interface DraftEntry {
  type: ItemType;
  id: string;
  topicId: string;
  topicTitle: string;
  /** Whether the topic it belongs to is itself published (so publishing this makes it visible). */
  topicPublished: boolean;
  label: string;
  updatedAt: string;
  updatedBy?: string;
}

/** Everything still in draft, newest first: the review queue. */
export function drafts(snapshot: ContentSnapshot): DraftEntry[] {
  const topics = new Map(snapshot.topics.map((t) => [t.id, t]));
  const title = (id: string) => topics.get(id)?.title ?? id;
  const topicPublished = (id: string) => {
    const t = topics.get(id);
    return !!t && published(t);
  };
  const draft = (x: { status?: 'draft' | 'published' }) => !published(x);
  const entries: DraftEntry[] = [
    ...snapshot.topics.filter(draft).map((t) => ({
      type: 'topic' as const,
      id: t.id,
      topicId: t.id,
      topicTitle: t.title,
      topicPublished: false,
      label: t.title,
      updatedAt: t.updatedAt,
      updatedBy: t.updatedBy,
    })),
    ...snapshot.references.filter(draft).map((r) => ({
      type: 'reference' as const,
      id: r.id,
      topicId: r.topicId,
      topicTitle: title(r.topicId),
      topicPublished: topicPublished(r.topicId),
      label: r.label,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
    })),
    ...snapshot.perspectives.filter(draft).map((p) => ({
      type: 'perspective' as const,
      id: p.id,
      topicId: p.topicId,
      topicTitle: title(p.topicId),
      topicPublished: topicPublished(p.topicId),
      label: `${p.stance}: ${p.holder}`,
      updatedAt: p.updatedAt,
      updatedBy: p.updatedBy,
    })),
    ...snapshot.relations.filter(draft).map((r) => ({
      type: 'relation' as const,
      id: r.id,
      topicId: r.fromId,
      topicTitle: title(r.fromId),
      topicPublished: topicPublished(r.fromId) && topicPublished(r.toId),
      label: `${r.kind} → ${title(r.toId)}`,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
    })),
  ];
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
