import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGES, isPageId, type Page, publicPage, workingPage } from './pages.js';

const at = '2026-09-27T00:00:00.000Z';

describe('pages', () => {
  it('falls back to the default until a page is published', () => {
    expect(publicPage('about', undefined)).toMatchObject({ state: 'default', title: 'About' });
    const saved: Page = { id: 'about', draft: { title: 'New', body: 'b', updatedAt: at } };
    expect(publicPage('about', saved).body).toBe(DEFAULT_PAGES.about.body);
    expect(workingPage('about', saved)).toMatchObject({ state: 'unpublished', title: 'New' });
  });

  it('keeps the live copy while the working copy changes', () => {
    const page: Page = {
      id: 'home',
      draft: { title: 'Edited', body: 'b2', updatedAt: at },
      published: { title: 'Live', body: 'b1', publishedAt: at },
    };
    expect(publicPage('home', page)).toMatchObject({ title: 'Live', state: 'published' });
    expect(workingPage('home', page)).toMatchObject({ title: 'Edited', state: 'changed' });
    expect(workingPage('home', { ...page, draft: { title: 'Live', body: 'b1', updatedAt: at } }).state).toBe('published');
  });
});

describe('isPageId', () => {
  it('accepts only the known page ids', () => {
    expect(isPageId('home')).toBe(true);
    expect(isPageId('about')).toBe(true);
    expect(isPageId('nope')).toBe(false);
    expect(isPageId(7)).toBe(false);
  });

  it('shows the default for an unsaved page to editors, and the live copy to readers', () => {
    expect(workingPage('home', undefined)).toMatchObject({ state: 'default', title: DEFAULT_PAGES.home.title });
    const published = { title: 'Live', body: 'b', publishedAt: at };
    expect(publicPage('home', { id: 'home', draft: { title: 'D', body: 'b', updatedAt: at }, published })).toMatchObject({
      state: 'published',
      publishedAt: at,
    });
  });
});
