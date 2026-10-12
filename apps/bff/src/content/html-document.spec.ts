import { describe, expect, it } from 'vitest';
import type { PageDocument } from '@greed/domain';
import { renderHtml } from './html-document.js';

const doc: PageDocument = {
  status: 200,
  title: 'A & B "quote"',
  description: 'x < y',
  path: '/t/a',
  robots: 'index, follow',
  type: 'article',
  text: 'Body <tag>',
};

describe('renderHtml', () => {
  it('escapes the page into tags and links the built stylesheet', () => {
    const html = renderHtml(doc, 'https://greed.example', { script: '/assets/app.js', style: '/assets/app.css' });
    expect(html).toContain('<title>A &amp; B &quot;quote&quot;</title>');
    expect(html).toContain('content="x &lt; y"');
    expect(html).toContain('Body &lt;tag&gt;');
    expect(html).toContain('href="https://greed.example/t/a"');
    expect(html).toContain('href="/assets/app.css"');
    expect(html).toContain('src="/assets/app.js"');
    expect(html).toContain('og:type" content="article"');
  });
});
