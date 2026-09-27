import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SectionTitle } from './bits';

/**
 * Renders the page Markdown subset (see packages/domain/src/pages.ts) as React
 * elements. Never uses innerHTML, so page text can't inject markup.
 */
export function Markdown({ source, lead = true }: { source: string; lead?: boolean }) {
  const blocks = source.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  let paragraphs = 0;
  return (
    <>
      {blocks.map((block, i) => {
        if (block.startsWith('## ')) return <SectionTitle key={i}>{block.slice(3)}</SectionTitle>;
        const lines = block.split('\n');
        if (lines.every((l) => /^[-*] /.test(l))) {
          return (
            <ul key={i} className="mb-8 flex list-disc flex-col gap-2 pl-5 text-steel">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        const isLead = lead && paragraphs++ === 0;
        return (
          <p key={i} className={isLead ? 'mb-4 text-lg text-snow' : 'mb-6 text-steel'}>
            {inline(lines.join(' '))}
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
      if (href!.startsWith('/') && !href!.startsWith('/api/')) return <Link key={i} to={href!}>{label}</Link>;
      if (/^(https?:\/\/|\/api\/)/.test(href!)) {
        const external = href!.startsWith('http');
        return (
          <a key={i} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {label}
          </a>
        );
      }
      return label; // anything else (javascript:, data:) renders as plain text
    }
    return part;
  });
}
