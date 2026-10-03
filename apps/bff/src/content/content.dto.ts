import {
  type EntityName,
  RELATION_KINDS,
  RELATION_PROVENANCES,
  type RelationKind,
  type RelationProvenance,
  STANCES,
  TRUST_RATINGS,
  type TrustRating,
  STATUS_ENTITY_NAMES,
  type Stance,
  STATUSES,
  type Status,
  TOPIC_KINDS,
  type TopicKind,
} from '@greed/domain';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// Every property carries a validator: the global ValidationPipe runs with
// whitelist + forbidNonWhitelisted, so an undecorated field would be rejected.

const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export class PointDto {
  @IsString()
  @MaxLength(4000)
  text!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  refIds!: string[];
}

export class SectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  id?: string;

  @IsString()
  @Length(1, 200)
  label!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  points!: PointDto[];
}

export class TopicInputDto {
  /** Optional explicit slug on create; ignored on update. */
  @IsOptional()
  @Matches(ID, { message: 'id must be a lowercase slug' })
  id?: string;

  @IsIn(TOPIC_KINDS)
  kind!: TopicKind;

  @IsString()
  @Length(3, 200)
  title!: string;

  @IsString()
  @MaxLength(6000)
  summary!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SectionDto)
  sections!: SectionDto[];

  @IsString()
  @MaxLength(6000)
  disputed!: string;

  @IsString()
  @MaxLength(20000)
  notes!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags!: string[];

  /** Omit to keep the current status (updates) or use the default (creates; see ContentService). */
  @IsOptional()
  @IsIn(STATUSES)
  status?: Status;
}

export class ReferenceInputDto {
  @IsString()
  @Length(1, 200)
  label!: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2000)
  url?: string;

  /** YYYY, YYYY-MM or YYYY-MM-DD; sources often only give a month. */
  @IsOptional()
  @Matches(/^\d{4}(-\d{2}(-\d{2})?)?$/, { message: 'publishedOn must be YYYY, YYYY-MM or YYYY-MM-DD' })
  publishedOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  excerpt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  /** Omit to keep the current status (updates) or use the default (creates; see ContentService). */
  @IsOptional()
  @IsIn(STATUSES)
  status?: Status;
}

export class PerspectiveInputDto {
  @IsIn(STANCES)
  stance!: Stance;

  @IsString()
  @Length(1, 200)
  holder!: string;

  @IsString()
  @Length(1, 8000)
  body!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  refIds!: string[];

  /** Omit to keep the current status (updates) or use the default (creates; see ContentService). */
  @IsOptional()
  @IsIn(STATUSES)
  status?: Status;
}

export class RelationInputDto {
  @IsString()
  @Length(1, 80)
  fromId!: string;

  @IsString()
  @Length(1, 80)
  toId!: string;

  @IsIn(RELATION_KINDS)
  kind!: RelationKind;

  @IsString()
  @MaxLength(2000)
  note!: string;

  @IsOptional()
  @IsIn(RELATION_PROVENANCES)
  provenance?: RelationProvenance;

  /** Omit to keep the current status (updates) or use the default (creates; see ContentService). */
  @IsOptional()
  @IsIn(STATUSES)
  status?: Status;
}

export class OutletInputDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  /** Host, e.g. "npr.org". A scheme or path is stripped. */
  @IsString()
  @Length(1, 253)
  domain!: string;

  /** Hard avoid: research never searches or fetches a paywalled outlet. */
  @IsBoolean()
  paywall!: boolean;

  /** high ranks first. */
  @IsIn(TRUST_RATINGS)
  accuracy!: TrustRating;

  /** How hard it pushes a side. low (less biased) ranks first. */
  @IsIn(TRUST_RATINGS)
  bias!: TrustRating;

  /** True when it only presents one side of a contested claim. */
  @IsBoolean()
  oneSided!: boolean;

  /** high ranks first. */
  @IsIn(TRUST_RATINGS)
  factual!: TrustRating;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: Status;
}

export class PageInputDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  /** Markdown subset; see packages/domain/src/pages.ts. */
  @IsString()
  @MaxLength(20000)
  body!: string;
}

/** Entities that carry a draft/published status (set_status works on these). */
export const ITEM_TYPES = STATUS_ENTITY_NAMES;

export class ItemRefDto {
  @IsIn(ITEM_TYPES)
  type!: EntityName;

  @IsString()
  @Length(1, 200)
  id!: string;
}

export class SetStatusDto {
  @IsIn(STATUSES)
  status!: Status;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ItemRefDto)
  items!: ItemRefDto[];
}
