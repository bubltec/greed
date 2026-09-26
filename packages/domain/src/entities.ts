/**
 * The content model. Everything the site shows is one of these five shapes.
 *
 * A Topic is one documented case, person, organization, or piece of synthesis.
 * References, Perspectives and Relations hang off topics and are edited
 * independently, so adding a source or a viewpoint never rewrites the topic.
 */

export const TOPIC_KINDS = ['case', 'person', 'organization', 'synthesis', 'thesis'] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number];

export const RELATION_KINDS = [
  'related',
  'same-actor',
  'same-context',
  'shared-mechanism',
  'cause-effect',
  'contradicts',
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** Where a relation came from: the original sourced doc, an inference, or an editor. */
export const RELATION_PROVENANCES = ['sourced', 'inferred', 'editor'] as const;
export type RelationProvenance = (typeof RELATION_PROVENANCES)[number];

/** Whose view a perspective represents. `editorial` is the site's own read. */
export const STANCES = ['critic', 'defender', 'official', 'legal', 'expert', 'editorial'] as const;
export type Stance = (typeof STANCES)[number];

export interface Point {
  text: string;
  /** Ids of this topic's References that back this point. */
  refIds: string[];
}

export interface Section {
  id: string;
  label: string;
  points: Point[];
}

interface Timestamps {
  createdAt: string;
  updatedAt: string;
  /** Display name or email of the last editor; absent for seeded rows. */
  updatedBy?: string;
}

export interface Topic extends Timestamps {
  id: string;
  kind: TopicKind;
  title: string;
  summary: string;
  sections: Section[];
  /** What is contested or unproven about this topic. Shown prominently, never buried. */
  disputed: string;
  /** Working notes and open research threads. */
  notes: string;
  tags: string[];
}

export interface Reference extends Timestamps {
  id: string;
  topicId: string;
  /** Publication or document name, e.g. "Washington Post". */
  label: string;
  url?: string;
  publishedOn?: string;
  /** Short quoted passage that supports the point. */
  excerpt?: string;
  note?: string;
}

export interface Perspective extends Timestamps {
  id: string;
  topicId: string;
  stance: Stance;
  /** Who holds this view, e.g. "Pentagon", "Rep. Pat Ryan", "ACLU". */
  holder: string;
  body: string;
  refIds: string[];
}

export interface Relation extends Timestamps {
  id: string;
  fromId: string;
  toId: string;
  kind: RelationKind;
  note: string;
  provenance: RelationProvenance;
}

export interface ContentSnapshot {
  topics: Topic[];
  references: Reference[];
  perspectives: Perspective[];
  relations: Relation[];
}

export function isTopicKind(value: unknown): value is TopicKind {
  return typeof value === 'string' && (TOPIC_KINDS as readonly string[]).includes(value);
}
