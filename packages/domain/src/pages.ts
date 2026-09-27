/**
 * Editable site pages (the home intro and About), as opposed to topics.
 *
 * A page keeps a working copy and a published copy: editors change the
 * working copy freely and publish when ready, so the live page never shows a
 * half-finished edit. A page that has never been saved uses DEFAULT_PAGES.
 *
 * Bodies are a small Markdown subset rendered as text, never as HTML:
 * blank-line paragraphs, `## ` headings, `- ` lists, **bold**, [links](url)
 * and [[topic-id]] links. The first paragraph is the lead.
 */

export const PAGE_IDS = ['home', 'about'] as const;
export type PageId = (typeof PAGE_IDS)[number];

export interface PageContent {
  title: string;
  body: string;
}

export interface Page {
  id: PageId;
  draft: PageContent & { updatedAt: string; updatedBy?: string };
  published?: PageContent & { publishedAt: string; publishedBy?: string };
}

export function isPageId(value: unknown): value is PageId {
  return typeof value === 'string' && (PAGE_IDS as readonly string[]).includes(value);
}

export const DEFAULT_PAGES: Record<PageId, PageContent> = {
  home: {
    title: 'Who holds power, who pays for it, and who is supposed to be watching.',
    body:
      'A cross-linked record of documented cases. Each entry carries its sources, what is still disputed, ' +
      'the competing perspectives on it, and the other entries it connects to.',
  },
  about: {
    title: 'About',
    body: `GREED documents the corruption, self-dealing and abuse of power of Donald Trump’s presidency: the first term, the years in between, and the second term now underway.

He isn’t doing it alone. Cabinet secretaries and agency heads, lawyers and loyalists, billionaire donors, lobbyists and whole industries carry it out, protect it and profit from it. Every entry names who did what, when, and who benefited.

## What’s here

- **Pay-to-play and self-dealing:** money demanded from companies, donors rewarded with policy, and the president’s own businesses profiting from the office.
- **Retaliation:** threats against critics, prosecutors, the press and political opponents, and the use of government power to punish them.
- **Dismantled oversight:** inspectors, regulators and enforcement gutted or handed to the industries they were supposed to police.
- **Abuse of power:** pardons for allies, manufactured emergencies, and claims of immunity from the law.
- **The human cost:** what the cuts, rollbacks and wars mean for people’s health, safety, rights and livelihoods.

## Follow the connections

None of this happens in isolation. The same people, the same money and the same playbook show up again and again. Every entry links to the others it connects to; the [map](/map) shows the whole web at once.

## Built on the record

- **Every point is sourced** and footnoted to the reporting, filings or documents behind it.
- **What’s disputed is marked** in red at the top of an entry, denials included, so nothing here rests on a claim that can’t be checked.
- **Their side is on the record too.** Official responses and defenses are quoted and attributed, next to the critics’.
- **Connections are labelled** as sourced or inferred, so you know which links a source states and which are our read.

## Open data

The whole record is free to download as JSON from [/api/export](/api/export).`,
  },
};

export type PageState = 'default' | 'published' | 'changed' | 'unpublished';

export interface PageView extends PageContent {
  id: PageId;
  state: PageState;
  updatedAt?: string;
  publishedAt?: string;
}

/** What a reader sees: the published copy, or the built-in default if never published. */
export function publicPage(id: PageId, page: Page | undefined): PageView {
  if (page?.published) {
    const { title, body, publishedAt } = page.published;
    return { id, title, body, state: 'published', publishedAt };
  }
  return { id, ...DEFAULT_PAGES[id], state: 'default' };
}

/** What an editor sees: the working copy, with how it relates to what's live. */
export function workingPage(id: PageId, page: Page | undefined): PageView {
  if (!page) return { id, ...DEFAULT_PAGES[id], state: 'default' };
  const { draft, published } = page;
  const state: PageState = !published
    ? 'unpublished'
    : published.title === draft.title && published.body === draft.body
      ? 'published'
      : 'changed';
  return {
    id,
    title: draft.title,
    body: draft.body,
    state,
    updatedAt: draft.updatedAt,
    publishedAt: published?.publishedAt,
  };
}
