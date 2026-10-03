import type { RelationKind, Stance, TopicKind } from './types';

export const KIND_LABEL: Record<TopicKind, string> = {
  case: 'Case',
  person: 'Person',
  organization: 'Org',
  synthesis: 'Synthesis',
  thesis: 'Thesis',
};

/** Border/text colour per kind, all from the NES palette. */
export const KIND_COLOR: Record<TopicKind, string> = {
  case: '#3cbcfc',
  person: '#a4e4fc',
  organization: '#fcfcfc',
  synthesis: '#f8b800',
  thesis: '#fce4a0',
};

export const RELATION_LABEL: Record<RelationKind, string> = {
  related: 'Related',
  'same-actor': 'Same actor',
  'same-context': 'Same context',
  'shared-mechanism': 'Shared mechanism',
  'cause-effect': 'Cause → effect',
  contradicts: 'Contradicts',
};

export const STANCE_LABEL: Record<Stance, string> = {
  critic: 'Critic',
  defender: 'Defender',
  official: 'Official position',
  legal: 'Legal view',
  expert: 'Expert view',
  editorial: 'Editorial read',
};

/**
 * Red marks the side excusing the conduct, blue the side calling it out: defending
 * corruption, misogyny or degradation is not a good thing, so the colours are
 * deliberately the reverse of "red = critical".
 */
export const STANCE_COLOR: Record<Stance, string> = {
  critic: '#3cbcfc',
  defender: '#f83800',
  official: '#fcfcfc',
  legal: '#a4e4fc',
  expert: '#f8b800',
  editorial: '#fce4a0',
};

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
