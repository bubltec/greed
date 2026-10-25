/**
 * The content model. Everything the site shows is one of these shapes.
 *
 * A Topic is one documented case, person, organization, or piece of synthesis.
 * References, Perspectives and Relations hang off topics and are edited
 * independently, so adding a source or a viewpoint never rewrites the topic.
 * An Outlet is a publication we might search or cite, ranked apart from any
 * one topic's references.
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

/**
 * How strongly an outlet shows a quality. For accuracy and factual reporting,
 * high ranks first. For bias, low (less biased) ranks first.
 */
export const TRUST_RATINGS = ['high', 'mixed', 'low'] as const;
export type TrustRating = (typeof TRUST_RATINGS)[number];

import type { Page } from './pages.js';

/**
 * Publishing state. Drafts are visible to editors (and in `?preview=1`) only.
 * Rows written before publishing existed have no status and count as published.
 */
export const STATUSES = ['draft', 'published'] as const;
export type Status = (typeof STATUSES)[number];

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
  status?: Status;
  /** When it was last published. */
  publishedAt?: string;
}

export interface Topic extends Timestamps {
  id: string;
  kind: TopicKind;
  title: string;
  summary: string;
  sections: Section[];
  /** A one-sentence note on the main denial or open question, shown small at the end of the entry. */
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
  /**
   * A circulating claim (a viral screenshot, a post) that is cited and answered, never embedded.
   * It carries a `verdict` instead of an attachment, which avoids copyright and misattribution problems.
   */
  viralClaim?: boolean;
  /** One line on what the record shows about the claim; required when `viralClaim` is set. */
  verdict?: string;
}

/**
 * What an attachment is. Viral screenshots are deliberately not a kind: they are cited
 * as a reference with `viralClaim` and a verdict, not stored or shown.
 */
export const ATTACHMENT_KINDS = ['primary-document', 'chart', 'scan'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** `pending`: text has not been extracted yet (a scan waiting for OCR). */
export const EXTRACTION_STATUSES = ['pending', 'done', 'failed'] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

/**
 * An archived copy of a primary document, chart or scan that backs a reference, so the
 * record keeps its evidence if the page moves or goes behind a paywall. The file itself
 * lives in the archive under a key derived from `sha256`; the row holds what a reader
 * and a model need: what it is, where it came from, when it was captured, and its text.
 */
export interface Attachment extends Timestamps {
  id: string;
  topicId: string;
  /** The reference this evidence supports; the points that cite that reference are the points it supports. */
  referenceId: string;
  kind: AttachmentKind;
  caption: string;
  /** Describes the file for someone who cannot see it. */
  altText: string;
  /** Where the file was captured from. */
  sourceUrl?: string;
  /** YYYY-MM-DD the archived copy was taken. */
  capturedAt: string;
  /** Hex SHA-256 of the archived bytes. */
  sha256: string;
  mimeType: string;
  bytes: number;
  /** Text read out of the file (a scan's OCR, or an editor's transcription). */
  extractedText?: string;
  extractionStatus: ExtractionStatus;
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

/**
 * A publication the record may search or cite. Paywalled outlets are stored so
 * research can skip them; they are never a source we fetch.
 */
export interface Outlet extends Timestamps {
  id: string;
  /** Display name, e.g. "NPR". */
  name: string;
  /** Host we match search results against, e.g. "npr.org". */
  domain: string;
  /** Hard avoid: never search or fetch this outlet. */
  paywall: boolean;
  /** Do the checkable facts hold up? */
  accuracy: TrustRating;
  /** How hard it pushes a side. High is more biased and ranks worse. */
  bias: TrustRating;
  /** Does it present only one side of a contested claim? */
  oneSided: boolean;
  /** Is this reporting, rather than opinion or rumor presented as news? */
  factual: TrustRating;
  note?: string;
}

export interface ContentSnapshot {
  topics: Topic[];
  references: Reference[];
  perspectives: Perspective[];
  relations: Relation[];
  /** Publication catalog. Absent on snapshots written before outlets existed. */
  outlets?: Outlet[];
  /** Archived evidence. Absent on snapshots written before attachments existed. */
  attachments?: Attachment[];
  /** Editable site pages; absent pages use their defaults. */
  pages?: Page[];
}

/** A row's publishing state; rows from before publishing existed are published. */
export function statusOf(item: { status?: Status }): Status {
  return item.status ?? 'published';
}

export function isTopicKind(value: unknown): value is TopicKind {
  return typeof value === 'string' && (TOPIC_KINDS as readonly string[]).includes(value);
}
