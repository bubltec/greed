export type {
  ActivityBrowse,
  ActivityEntry,
  ActivityType,
  ContentSnapshot,
  DraftEntry,
  GraphView,
  ItemType,
  Perspective,
  Point,
  RelatedTopic,
  Reference,
  Relation,
  RelationKind,
  Section,
  SortDir,
  Stance,
  Status,
  Topic,
  TopicBrowse,
  TopicKind,
  TopicSort,
  TopicSummary,
  TopicView,
} from '@greed/domain';
import type { RelationKind, RelationProvenance, Stance, TopicKind } from '@greed/domain';

/** Request bodies; mirror the BFF's DTOs. */
export interface TopicInput {
  id?: string;
  kind: TopicKind;
  title: string;
  summary: string;
  sections: { id?: string; label: string; points: { text: string; refIds: string[] }[] }[];
  disputed: string;
  notes: string;
  tags: string[];
}

export interface ReferenceInput {
  label: string;
  url?: string;
  publishedOn?: string;
  excerpt?: string;
  note?: string;
}

export interface PerspectiveInput {
  stance: Stance;
  holder: string;
  body: string;
  refIds: string[];
}

export interface RelationInput {
  fromId: string;
  toId: string;
  kind: RelationKind;
  note: string;
  provenance?: RelationProvenance;
}
