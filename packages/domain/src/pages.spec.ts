import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGES, isPageId, parsePageBody, type Page, publicPage, workingPage } from './pages.js';

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

describe('parsePageBody', () => {
  it('keeps paragraphs, headings and lists', () => {
    expect(parsePageBody('Lead\n\n## What’s here\n\n- one\n* two')).toEqual([
      { type: 'paragraph', text: 'Lead' },
      { type: 'heading', text: 'What’s here' },
      { type: 'list', items: ['one', 'two'] },
    ]);
  });

  it('turns a blockquote into a note, and a tone marker into that alert', () => {
    expect(parsePageBody('> **Author’s note.** The record is sourced.')).toEqual([
      { type: 'alert', tone: 'note', text: '**Author’s note.** The record is sourced.' },
    ]);
    expect(parsePageBody('> [!info] Context\n> continues')).toEqual([{ type: 'alert', tone: 'info', text: 'Context continues' }]);
    expect(parsePageBody('> [!success] Saved')).toEqual([{ type: 'alert', tone: 'success', text: 'Saved' }]);
    expect(parsePageBody('> [!ok] Saved')).toEqual([{ type: 'alert', tone: 'success', text: 'Saved' }]);
    expect(parsePageBody('> [!WARN] Careful')).toEqual([{ type: 'alert', tone: 'warn', text: 'Careful' }]);
    expect(parsePageBody('> [!warning] Careful')).toEqual([{ type: 'alert', tone: 'warn', text: 'Careful' }]);
    expect(parsePageBody('> [!error] Stop')).toEqual([{ type: 'alert', tone: 'error', text: 'Stop' }]);
    expect(parsePageBody('> [!danger] Stop')).toEqual([{ type: 'alert', tone: 'error', text: 'Stop' }]);
    expect(parsePageBody('> [!nope] Still a note')).toEqual([{ type: 'alert', tone: 'note', text: '[!nope] Still a note' }]);
  });

  it('leaves a line that is not a quote as a paragraph', () => {
    expect(parsePageBody('> quoted\nplain')).toEqual([{ type: 'paragraph', text: '> quoted plain' }]);
    expect(parsePageBody('')).toEqual([]);
    expect(parsePageBody('> [!note]\r\n> Only the label')).toEqual([{ type: 'alert', tone: 'note', text: 'Only the label' }]);
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
