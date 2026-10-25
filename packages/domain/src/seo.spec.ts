import { describe, expect, it } from 'vitest';
import type { ContentSnapshot, Topic } from './entities.js';
import { ContentIndex } from './views.js';
import { metaDescription, pageDocument, pageLead, plain, llmsTxt, sitemapXml, SITE_DESCRIPTION } from './seo.js';

const at = '2026-04-01T00:00:00.000Z';
const topic = (id: string, over: Partial<Topic> = {}): Topic => ({
  id,
  kind: 'case',
  title: id,
  summary: `${id} summary`,
  sections: [{ id: 's', label: 'What happened', points: [{ text: `Point about [[${id}]] and **bold**.`, refIds: [] }] }],
  disputed: '',
  notes: '',
  tags: [],
  createdAt: at,
  updatedAt: at,
  status: 'published',
  ...over,
});

function index(over: Partial<ContentSnapshot> = {}) {
  return new ContentIndex({
    topics: [topic('alpha', { title: 'Alpha', updatedAt: '2026-05-01T00:00:00.000Z', summary: 'Alpha happened <script>alert(1)</script>' }), topic('beta', { title: 'Beta', summary: 'Beta followed.' })],
    references: [{ id: 'r1', topicId: 'alpha', label: 'NPR', url: 'https://npr.org/x', publishedOn: '2026-04', excerpt: '', note: '', createdAt: at, updatedAt: at, status: 'published' }],
    perspectives: [{ id: 'p1', topicId: 'alpha', stance: 'critic', holder: 'A critic', body: 'They deny it.', refIds: [], createdAt: at, updatedAt: at, status: 'published' }],
    relations: [{ id: 'rel', fromId: 'alpha', toId: 'beta', kind: 'related', note: 'Same week.', provenance: 'sourced', createdAt: at, updatedAt: at, status: 'published' }],
    ...over,
  });
}

describe('page documents', () => {
  const published = index();

  it('gives the home page its own title, lead, and every entry', () => {
    const home = pageDocument('/', published);
    expect(home).toMatchObject({ status: 200, path: '/', robots: 'index, follow', type: 'website' });
    expect(home.title).toContain('Who holds power');
    expect(home.description).toContain('cross-linked record');
    expect(home.text.indexOf('Alpha')).toBeLessThan(home.text.indexOf('Beta'));
    expect(home.text).toContain('Alpha happened');
  });

  it('writes a topic as the entry a reader sees, and 404s when it is absent', () => {
    const doc = pageDocument('/t/alpha', published);
    expect(doc).toMatchObject({ status: 200, path: '/t/alpha', type: 'article', robots: 'index, follow' });
    expect(doc.title).toBe('Alpha · GREED');
    expect(doc.description).toContain('Alpha happened <script>alert(1)</script>');
    expect(doc.text).toContain('What happened');
    expect(doc.text).toContain('Point about Alpha and bold.');
    expect(doc.text).toContain('Critic — A critic');
    expect(doc.text).toContain('[1] NPR (https://npr.org/x)');
    expect(doc.text).toContain('Related — Beta');
    expect(pageDocument('/t/missing', published)).toMatchObject({ status: 404, robots: 'noindex, nofollow' });
  });

  it('lists archived evidence under its source number, and states a viral claim’s verdict instead of showing it', () => {
    const doc = pageDocument(
      '/t/alpha',
      index({
        references: [
          { id: 'r1', topicId: 'alpha', label: 'DOJ press release', url: 'https://justice.gov/x', createdAt: at, updatedAt: at, status: 'published' },
          { id: 'r2', topicId: 'alpha', label: 'Viral post', viralClaim: true, verdict: 'The addendum does not say this.', createdAt: '2026-04-02T00:00:00.000Z', updatedAt: at, status: 'published' },
          { id: 'r3', topicId: 'alpha', label: 'Unjudged post', viralClaim: true, createdAt: '2026-04-03T00:00:00.000Z', updatedAt: at, status: 'published' },
        ],
        attachments: [
          { id: 'a1', topicId: 'alpha', referenceId: 'r1', kind: 'scan', caption: 'Signed addendum', altText: 'A signed page', sourceUrl: 'https://justice.gov/x.pdf', capturedAt: '2026-10-01', sha256: 'a'.repeat(64), mimeType: 'application/pdf', bytes: 10, extractedText: 'The addendum reads: payments continue.', extractionStatus: 'done', createdAt: at, updatedAt: at, status: 'published' },
          { id: 'a2', topicId: 'alpha', referenceId: 'gone', kind: 'chart', caption: 'Orphan chart', altText: 'A chart', capturedAt: '2026-10-02', sha256: 'b'.repeat(64), mimeType: 'image/png', bytes: 5, extractionStatus: 'pending', createdAt: at, updatedAt: at, status: 'published' },
        ],
      }),
    );
    expect(doc.text).toContain('[2] Viral post · Viral claim: The addendum does not say this.');
    expect(doc.text).toContain('[3] Unjudged post · Viral claim: no verdict recorded');
    expect(doc.text).toContain('Evidence');
    expect(doc.text).toContain('Source [1] — Signed addendum (Scan, captured 2026-10-01 from https://justice.gov/x.pdf)\nThe addendum reads: payments continue.');
    expect(doc.text).toContain('Source [?] — Orphan chart (Chart, captured 2026-10-02)');
    expect(pageDocument('/t/beta', published).text).not.toContain('Evidence');
  });

  it('keeps drafts out of the public document', () => {
    const withDraft = index({
      topics: [
        topic('alpha', { title: 'Alpha' }),
        topic('secret', { title: 'Secret', status: 'draft', summary: 'Do not publish this.' }),
      ],
    });
    const pub = new ContentIndex(withDraft.snapshot).published();
    expect(pageDocument('/t/secret', pub).status).toBe(404);
    expect(pageDocument('/', pub).text).not.toContain('Secret');
  });

  it('describes the map, the log, about, editors, and unknown paths', () => {
    expect(pageDocument('/map/', published).text).toContain('Alpha → Beta');
    expect(pageDocument('/activity', published).text).toContain('Alpha');
    expect(pageDocument('/about', published).description.length).toBeGreaterThan(20);
    expect(pageDocument('/admin/t/alpha', published)).toMatchObject({ robots: 'noindex, nofollow', path: '/admin/t/alpha' });
    expect(pageDocument('/nope', published).status).toBe(404);
  });

  it('lists the same public urls for models and for the sitemap', () => {
    const origin = 'https://greed.example';
    expect(llmsTxt(published, origin)).toContain(`[Alpha](${origin}/t/alpha)`);
    expect(llmsTxt(published, origin)).not.toContain('secret');
    const xml = sitemapXml(published, origin);
    expect(xml).toContain('<loc>https://greed.example/t/alpha</loc>');
    expect(xml).toContain('<loc>https://greed.example/about</loc>');
    expect(xml).not.toContain('&');
  });

  it('cuts a description on a word and falls back when there is nothing to say', () => {
    expect(metaDescription('')).toBe(SITE_DESCRIPTION);
    expect(metaDescription(`${'word '.repeat(80)}end`)).toMatch(/…$/);
    expect(metaDescription(`${'word '.repeat(80)}end`)).not.toContain('end');
    expect(metaDescription('x'.repeat(200))).toMatch(/…$/);
  });

  it('covers an empty record, a bare entry, and the markup the text keeps as words', () => {
    const empty = new ContentIndex({ topics: [], references: [], perspectives: [], relations: [] });
    expect(pageDocument('/', empty).text).not.toContain('Entries');
    expect(pageDocument('/map', empty).text).toContain('0 entries, 0 links');
    expect(pageDocument('/activity', empty).text).toContain('Nothing has been published yet.');
    expect(pageDocument('about?x=1#y', empty).path).toBe('/about');
    expect(pageLead('## Only a heading')).toBe('');
    expect(pageLead('> [!warn] Watch this')).toContain('Watch this');
    expect(plain('See [[beta|the other]] and [NPR](https://npr.org).')).toBe('See the other and NPR (https://npr.org).');
    expect(plain('[[unknown]]', new Map())).toBe('unknown');

    const bare = topic('bare', {
      title: 'Bare & Co',
      summary: '',
      sections: [{ id: 's', label: '', points: [{ text: '', refIds: [] }] }],
      notes: 'A note.',
      disputed: 'Contested.',
    });
    const one = new ContentIndex({ topics: [bare], references: [], perspectives: [], relations: [] });
    const doc = pageDocument('/t/bare', one);
    expect(doc.description).toBe('Bare & Co');
    expect(doc.text).toContain('Research notes');
    expect(doc.text).toContain('No sources attached yet.');
    expect(doc.text).toContain('Not linked to anything yet.');
    const many = new ContentIndex({
      topics: Array.from({ length: 26 }, (_, i) => topic(`t${i}`, { title: `T${i}`, updatedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` })),
      references: [],
      perspectives: [],
      relations: [],
    });
    expect(pageDocument('/activity', many).text).toContain('1 older entries');
    expect(sitemapXml(one, 'https://ex.test/?a=1&b=2')).toContain('&amp;');
    const linked = new ContentIndex({
      topics: [bare, topic('other', { title: 'Other' })],
      references: [{ id: 'r', topicId: 'bare', label: 'Memo', createdAt: at, updatedAt: at, status: 'published' }],
      perspectives: [],
      relations: [{ id: 'rel', fromId: 'bare', toId: 'other', kind: 'contradicts', note: '', provenance: 'sourced', createdAt: at, updatedAt: at, status: 'published' }],
    });
    expect(pageDocument('/t/bare', linked).text).toContain('[1] Memo');
    expect(pageDocument('/t/bare', linked).text).toContain('Contradicts — Other');
    expect(pageDocument('/map', linked).text).toContain('Bare & Co → Other');
    expect(sitemapXml(one, 'https://ex.test/?q="a<b>&c"')).toContain('&quot;a&lt;b&gt;&amp;c&quot;');
  });
});
