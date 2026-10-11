import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { pageLink, parsePageBody, type AlertTone } from '@greed/domain';
import { SectionTitle } from './bits';

/**
 * Renders the page Markdown subset (see packages/domain/src/pages.ts) as React
 * elements. Never uses innerHTML, so page text can't inject markup.
 */
const ALERT: Record<AlertTone, { border: string; label: string; title: string }> = {
  note: { border: 'border-steel', label: 'text-steel', title: 'Note' },
  info: { border: 'border-sky', label: 'text-sky', title: 'Info' },
  success: { border: 'border-ice', label: 'text-ice', title: 'Success' },
  warn: { border: 'border-bolt', label: 'text-bolt', title: 'Warning' },
  error: { border: 'border-hurt', label: 'text-hurt', title: 'Error' },
};

export function Markdown({ source, lead = true }: { source: string; lead?: boolean }) {
  const blocks = parsePageBody(source);
  let paragraphs = 0;
  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === 'heading') return <SectionTitle key={i}>{block.text}</SectionTitle>;
        if (block.type === 'list') {
          return (
            <ul key={i} className="mb-8 flex list-disc flex-col gap-2 pl-5 text-steel">
              {block.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'alert') {
          const style = ALERT[block.tone];
          return (
            <aside key={i} className={`mb-6 border-2 ${style.border} bg-night px-4 py-3`}>
              <p className={`pixel mb-2 text-[0.5rem] ${style.label}`}>{style.title}</p>
              {block.text && <p className="text-snow">{inline(block.text)}</p>}
            </aside>
          );
        }
        const isLead = lead && paragraphs++ === 0;
        return (
          <p key={i} className={isLead ? 'mb-4 text-lg text-snow' : 'mb-6 text-steel'}>
            {inline(block.text)}
          </p>
        );
      })}
    </>
  );
}

const TOKEN = /(\*\*[^*]+\*\*|\[\[[a-z0-9-]+\]\]|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  return text.split(TOKEN).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="text-snow">
          {part.slice(2, -2)}
        </strong>
      );
    }
    const wiki = part.match(/^\[\[([a-z0-9-]+)\]\]$/);
    if (wiki) return <Link key={i} to={`/t/${wiki[1]}`}>{wiki[1]}</Link>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const [, label, href] = link;
      const dest = pageLink(href!);
      if (!dest) return label; // javascript:, data:, and anything else stay plain text
      if (dest.kind === 'route') return <Link key={i} to={dest.to}>{label}</Link>;
      return (
        <a key={i} href={dest.href} {...(dest.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {label}
        </a>
      );
    }
    return part;
  });
}
