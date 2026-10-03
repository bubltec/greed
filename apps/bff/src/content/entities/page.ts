import { ENTITY_DEFS, isPageId, PAGE_IDS, type Page, workingPage } from '@greed/domain';
import { PageInputDto } from '../content.dto.js';
import { defineEntity } from '../entity.js';

/**
 * Site pages keep a working copy and a published copy in one row (lifecycle
 * "versioned"), so they implement `build`/`publishItem` instead of `fields`.
 * Their ids are fixed: update creates the row on first save.
 */
export const pageSpec = defineEntity<Page, PageInputDto>({
  def: ENTITY_DEFS.page,
  dto: PageInputDto,
  route: 'pages',
  fixedIds: { all: () => PAGE_IDS, has: isPageId },

  /** Saves the working copy; the live page is unchanged until publish. */
  build: (input, { existing, now, by }) => ({
    id: existing!.id,
    draft: { title: input.title.trim(), body: input.body.trim(), updatedAt: now, updatedBy: by },
    published: existing?.published,
  }),

  /** Publishes the working copy (the default copy, if the page was never edited). */
  publishItem: (page, { now, by }) => {
    const draft = page.draft ?? { ...workingPage(page.id as never, undefined), updatedAt: now, updatedBy: by };
    return {
      id: page.id,
      draft,
      published: { title: draft.title, body: draft.body, publishedAt: now, publishedBy: by },
    } as Page;
  },

  toInput: (page) => {
    const { title, body } = workingPage(page.id as never, page.draft ? page : undefined);
    return { title, body };
  },

  /** A page that was never saved reads as its built-in default. */
  present: (page) => workingPage(page.id as never, page.draft ? page : undefined),

  mcp: {
    get: {
      idArg: 'id',
      description:
        'Read an editable site page (home intro or About): its working copy, and whether that differs from what is live. ' +
        'Bodies use a Markdown subset: paragraphs, "## " headings, "- " lists, **bold**, [text](url) and [[topic-id]] links.',
    },
    update: {
      idArg: 'id',
      description:
        'Replace a page’s working copy (title and full body). The live page does not change until publish_page, which you should only call when the user asks.',
    },
    publish: { idArg: 'id', description: 'Make a page’s working copy live. Only when the user explicitly asks.' },
    fields: {
      title: 'Page title (for home, the headline).',
      body: 'Full page body in the Markdown subset described in get_page.',
    },
  },
});
