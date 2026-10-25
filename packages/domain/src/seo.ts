import type { ContentIndex, TopicView } from './views.js';
import { publicPage, parsePageBody, type PageBlock, type PageContent } from './pages.js';
import type { AttachmentKind, RelationKind, Stance, TopicKind } from './entities.js';

/** Shown when a page has no lead of its own, and in the static shell before a page loads. */
export const SITE_DESCRIPTION =
  'A sourced, cross-linked record of self-dealing, abuse of power and the people who enable it, with references and competing perspectives on every entry.';

export const SITE_NAME = 'GREED';

const KIND_LABEL: Record<TopicKind, string> = {
  case: 'Case',
  person: 'Person',
  organization: 'Organization',
  synthesis: 'Synthesis',
  thesis: 'Thesis',
};

const ATTACHMENT_LABEL: Record<AttachmentKind, string> = {
  'primary-document': 'Primary document',
  chart: 'Chart',
  scan: 'Scan',
};

const RELATION_LABEL: Record<RelationKind, string> = {
  related: 'Related',
  'same-actor': 'Same actor',
  'same-context': 'Same context',
  'shared-mechanism': 'Shared mechanism',
  'cause-effect': 'Cause and effect',
  contradicts: 'Contradicts',
};

const STANCE_LABEL: Record<Stance, string> = {
  critic: 'Critic',
  defender: 'Defender',
  official: 'Official position',
  legal: 'Legal view',
  expert: 'Expert view',
  editorial: 'Editorial read',
};

export const MAP_LEAD = 'Every entry and the links between them, as one web.';
export const LOG_LEAD = 'Additions and edits across the record.';
export const EDITORS_LEAD = 'Editing the record. This part of the site is not indexed.';
export const NOT_FOUND_LEAD = 'That page does not exist.';

/** What one URL should tell a reader, a crawler, or a model that does not run the app. */
export interface PageDocument {
  status: 200 | 404;
  /** Full document title, already including the site name. */
  title: string;
  description: string;
  /** Path only, beginning with `/`. */
  path: string;
  robots: 'index, follow' | 'noindex, nofollow';
  type: 'website' | 'article';
  /** The words on the page, in reading order. */
  text: string;
}

export function documentTitle(page?: string): string {
  return page ? `${page} · ${SITE_NAME}` : `${SITE_NAME} — power, money & oversight`;
}

/** One line for a meta description: markup removed, whitespace collapsed, cut on a word. */
export function metaDescription(text: string, max = 180): string {
  const flat = plain(text).replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat || SITE_DESCRIPTION;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 80 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** `[[id]]` and markdown links become words. Nothing here is HTML. */
export function plain(text: string, titles?: ReadonlyMap<string, string>): string {
  return text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id: string, label?: string) => label?.trim() || titles?.get(id.trim()) || id.trim())
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1');
}

/** The first paragraph of a page body, with markup turned into words. */
export function pageLead(body: string, titles?: ReadonlyMap<string, string>): string {
  return leadOf(body, titles);
}

function leadOf(body: string, titles?: ReadonlyMap<string, string>): string {
  const block = parsePageBody(body).find((b) => b.type === 'paragraph' || b.type === 'alert');
  return block ? plain(block.text, titles) : '';
}

function blocksToText(blocks: PageBlock[], titles?: ReadonlyMap<string, string>): string {
  return blocks
    .map((block) => {
      if (block.type === 'heading') return block.text;
      if (block.type === 'list') return block.items.map((item) => `- ${plain(item, titles)}`).join('\n');
      return plain(block.text, titles);
    })
    .filter(Boolean)
    .join('\n\n');
}

function titlesOf(index: ContentIndex): Map<string, string> {
  return new Map(index.snapshot.topics.map((t) => [t.id, t.title]));
}

function head(over: Omit<PageDocument, 'status' | 'robots' | 'type'> & Partial<Pick<PageDocument, 'status' | 'robots' | 'type'>>): PageDocument {
  return {
    status: over.status ?? 200,
    robots: over.robots ?? 'index, follow',
    type: over.type ?? 'website',
    title: over.title,
    description: over.description,
    path: over.path,
    text: over.text,
  };
}

/** The document for a public URL. `index` must already be the published view: drafts are never included. */
export function pageDocument(path: string, index: ContentIndex): PageDocument {
  const pathname = normalizePath(path);
  const titles = titlesOf(index);
  if (pathname === '/') return homeDocument(index, titles);
  if (pathname === '/about') return aboutDocument(index, titles);
  if (pathname === '/map') return mapDocument(index, titles);
  if (pathname === '/activity') return logDocument(index);
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return editorsDocument(pathname);
  const topic = /^\/t\/([^/]+)$/.exec(pathname);
  if (topic) return topicDocument(decodeURIComponent(topic[1]!), index, titles);
  return missing(pathname);
}

export function homeDocument(index: ContentIndex, titles = titlesOf(index)): PageDocument {
  const page = sitePage('home', index);
  const entries = [...index.summaries()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
  const list = entries.map((t) => `${t.title}\n${plain(t.summary, titles)}`.trim()).join('\n\n');
  return head({
    title: documentTitle(page.title),
    description: metaDescription(leadOf(page.body, titles) || page.title),
    path: '/',
    text: [page.title, blocksToText(parsePageBody(page.body), titles), entries.length ? `Entries\n\n${list}` : ''].filter(Boolean).join('\n\n'),
  });
}

export function aboutDocument(index: ContentIndex, titles = titlesOf(index)): PageDocument {
  const page = sitePage('about', index);
  const text = blocksToText(parsePageBody(page.body), titles);
  return head({
    title: documentTitle(page.title),
    description: metaDescription(leadOf(page.body, titles) || page.title),
    path: '/about',
    text: [page.title, text].filter(Boolean).join('\n\n'),
  });
}

export function mapDocument(index: ContentIndex, titles = titlesOf(index)): PageDocument {
  const graph = index.graph();
  const entries = graph.nodes.map((n) => `- ${n.title} (${KIND_LABEL[n.kind]})`).join('\n');
  const links = graph.edges
    .map((e) => `- ${titles.get(e.from) ?? e.from} → ${titles.get(e.to) ?? e.to} (${RELATION_LABEL[e.kind]})`)
    .join('\n');
  return head({
    title: documentTitle('Map'),
    description: metaDescription(`${MAP_LEAD} ${graph.nodes.length} entries, ${graph.edges.length} links.`),
    path: '/map',
    text: [`Map`, `${MAP_LEAD} ${graph.nodes.length} entries, ${graph.edges.length} links.`, entries && `Entries\n\n${entries}`, links && `Links\n\n${links}`]
      .filter(Boolean)
      .join('\n\n'),
  });
}

export function logDocument(index: ContentIndex): PageDocument {
  const entries = index.allActivity();
  const lines = entries
    .slice(0, 25)
    .map((e) => `- ${e.updatedAt.slice(0, 10)} · ${e.topicTitle} — ${e.label}`)
    .join('\n');
  const more = entries.length > 25 ? `\n\n${entries.length - 25} older entries are on later pages of the log.` : '';
  return head({
    title: documentTitle('Log'),
    description: metaDescription(LOG_LEAD),
    path: '/activity',
    text: [`Log`, LOG_LEAD, lines ? `Newest\n\n${lines}${more}` : 'Nothing has been published yet.'].filter(Boolean).join('\n\n'),
  });
}

export function editorsDocument(path = '/admin'): PageDocument {
  return head({
    title: documentTitle('Editors'),
    description: EDITORS_LEAD,
    path,
    robots: 'noindex, nofollow',
    text: `Editors\n\n${EDITORS_LEAD}`,
  });
}

export function topicDocument(id: string, index: ContentIndex, titles = titlesOf(index)): PageDocument {
  const view = index.view(id);
  if (!view) return missing(`/t/${id}`);
  return head({
    title: documentTitle(view.topic.title),
    description: metaDescription(view.topic.summary || view.topic.title),
    path: `/t/${view.topic.id}`,
    type: 'article',
    text: topicText(view, titles),
  });
}

function topicText(view: TopicView, titles: Map<string, string>): string {
  const { topic, references, perspectives, attachments, related } = view;
  const parts = [`${topic.title}`, `${KIND_LABEL[topic.kind]}`, plain(topic.summary, titles)];
  for (const section of topic.sections) {
    const points = section.points.map((p) => plain(p.text, titles)).filter(Boolean);
    if (section.label || points.length) parts.push([section.label, ...points].filter(Boolean).join('\n'));
  }
  if (perspectives.length) {
    parts.push(
      [
        'Perspectives',
        ...perspectives.map((p) => `${STANCE_LABEL[p.stance]} — ${p.holder}\n${plain(p.body, titles)}`.trim()),
      ].join('\n\n'),
    );
  }
  if (topic.notes.trim()) parts.push(`Research notes\n${plain(topic.notes, titles)}`);
  if (topic.disputed.trim()) parts.push(`Note\n${plain(topic.disputed, titles)}`);
  parts.push(
    references.length
      ? [
          'Sources',
          ...references.map(
            (r, i) =>
              `[${i + 1}] ${r.label}${r.url ? ` (${r.url})` : ''}${r.publishedOn ? ` · ${r.publishedOn}` : ''}${r.viralClaim ? ` · Viral claim: ${r.verdict ?? 'no verdict recorded'}` : ''}`,
          ),
        ].join('\n')
      : 'Sources\nNo sources attached yet.',
  );
  if (attachments.length) {
    const number = new Map(references.map((r, i) => [r.id, i + 1]));
    parts.push(
      [
        'Evidence',
        ...attachments.map(
          (a) =>
            `Source [${number.get(a.referenceId) ?? '?'}] — ${a.caption} (${ATTACHMENT_LABEL[a.kind]}, captured ${a.capturedAt}${a.sourceUrl ? ` from ${a.sourceUrl}` : ''})${a.extractedText ? `\n${a.extractedText}` : ''}`,
        ),
      ].join('\n\n'),
    );
  }
  parts.push(
    related.length
      ? ['Connections', ...related.map((r) => `${RELATION_LABEL[r.relation.kind]} — ${r.other.title}${r.relation.note ? `\n${plain(r.relation.note, titles)}` : ''}`)].join('\n\n')
      : 'Connections\nNot linked to anything yet.',
  );
  return parts.filter(Boolean).join('\n\n');
}

function sitePage(id: 'home' | 'about', index: ContentIndex): PageContent {
  return publicPage(id, index.snapshot.pages?.find((p) => p.id === id));
}

function missing(path: string): PageDocument {
  return head({
    status: 404,
    title: documentTitle('Not found'),
    description: NOT_FOUND_LEAD,
    path,
    robots: 'noindex, nofollow',
    text: `Not found\n\n${NOT_FOUND_LEAD}`,
  });
}

function normalizePath(path: string): string {
  const pathname = decodeURIComponent((path.split('?')[0] ?? '/').split('#')[0] ?? '/');
  const withSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) return withSlash.slice(0, -1);
  return withSlash || '/';
}

/** An index of the public pages, for models that look for `/llms.txt`. */
export function llmsTxt(index: ContentIndex, origin: string): string {
  const home = homeDocument(index);
  const entries = [...index.summaries()].sort((a, b) => a.title.localeCompare(b.title));
  const lines = [
    `# ${SITE_NAME}`,
    `> ${home.description}`,
    '',
    'The HTML at each URL below contains that page’s text.',
    '',
    '## Pages',
    `- [Home](${origin}/): ${home.description}`,
    `- [Map](${origin}/map): ${MAP_LEAD}`,
    `- [Log](${origin}/activity): ${LOG_LEAD}`,
    `- [About](${origin}/about): ${aboutDocument(index).description}`,
    '',
    '## Entries',
    ...entries.map((t) => `- [${t.title}](${origin}/t/${t.id}): ${metaDescription(t.summary, 140)}`),
    '',
  ];
  return lines.join('\n');
}

/** Sitemap of the same public URLs. */
export function sitemapXml(index: ContentIndex, origin: string): string {
  const paths = ['/', '/map', '/activity', '/about', ...index.summaries().map((t) => `/t/${t.id}`)];
  const urls = paths
    .map((path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
