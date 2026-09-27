import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { KIND_COLOR, KIND_LABEL } from '../lib/labels';
import type { TopicKind } from '../lib/types';

export function KindBadge({ kind }: { kind: TopicKind }) {
  const color = KIND_COLOR[kind];
  return (
    <span className="pixel inline-block border-2 px-1.5 py-0.5 text-[0.5rem]" style={{ borderColor: color, color }}>
      {KIND_LABEL[kind]}
    </span>
  );
}

/** Yellow: not public yet. Only editors in preview (or the editor) ever see it. */
export function DraftFlag({ small }: { small?: boolean }) {
  return (
    <span
      className={`pixel inline-block border-2 border-bolt text-bolt ${small ? 'px-1 py-0 text-[0.4375rem]' : 'px-1.5 py-0.5 text-[0.5rem]'}`}
    >
      Draft
    </span>
  );
}

/**
 * Mega Man's energy meter, turned sideways: one segment per link, capped.
 * A glance at how connected a topic is.
 */
export function EnergyBar({ value, max = 12, label }: { value: number; max?: number; label: string }) {
  const filled = Math.min(value, max);
  return (
    <span className="inline-flex items-center gap-2" title={`${value} ${label}`}>
      <span className="inline-flex gap-[2px] border-2 border-deep bg-void p-[2px]" aria-hidden>
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={`h-2.5 w-1 ${i < filled ? 'bg-bolt' : 'bg-night'}`} />
        ))}
      </span>
      <span className="text-xs text-steel">
        {value} {label}
      </span>
    </span>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="pixel text-[0.6875rem] text-sky">{children}</h2>
      {right}
    </div>
  );
}

export function Loading() {
  return <p className="pixel animate-pulse text-[0.625rem] text-sky">Loading…</p>;
}

export function ErrorBox({ error }: { error: Error }) {
  return (
    <div className="border-2 border-hurt p-4 text-sm text-snow">
      <p className="pixel mb-2 text-[0.625rem] text-hurt">Error</p>
      {error.message}
    </div>
  );
}

const URL_RE = /(https?:\/\/[^\s)]+)/g;
const WIKI_RE = /\[\[([a-z0-9-]+)\]\]/g;

/**
 * Plain text with bare URLs and [[topic-id]] links made clickable. Never
 * renders HTML from content, so there is nothing to sanitise.
 */
export function RichText({ text, titles }: { text: string; titles?: Map<string, string> }) {
  const parts: ReactNode[] = [];
  let key = 0;
  for (const chunk of text.split(WIKI_RE).entries()) {
    const [i, value] = chunk;
    if (i % 2 === 1) {
      parts.push(
        <Link key={key++} to={`/t/${value}`}>
          {titles?.get(value) ?? value}
        </Link>,
      );
      continue;
    }
    for (const [j, piece] of value.split(URL_RE).entries()) {
      if (j % 2 === 1) {
        let host = piece;
        try {
          host = new URL(piece).hostname.replace(/^www\./, '');
        } catch {
          /* keep raw */
        }
        parts.push(
          <a key={key++} href={piece} target="_blank" rel="noopener noreferrer">
            {host}
          </a>,
        );
      } else if (piece) {
        parts.push(piece);
      }
    }
  }
  return <>{parts}</>;
}
