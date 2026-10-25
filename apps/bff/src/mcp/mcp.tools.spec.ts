import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryContentStore } from '@greed/domain';
import { InMemoryArchive } from '../archive/archive.js';
import type { BinaryResponse } from '../archive/ingest.js';
import { ContentService } from '../content/content.service.js';
import { dto, pick, requireString } from './args.js';
import { dtoKeys, dtoSchema } from './dto-schema.js';
import { McpService } from './mcp.service.js';
import { TopicInputDto } from '../content/content.dto.js';

/** The tools called directly (no HTTP), covering the options the end-to-end test doesn't. */
let content: ContentService;
let mcp: McpService;
const run = (name: string, args: Record<string, unknown> = {}) => mcp.call(name, args, 'tester (mcp)') as Promise<any>;

beforeEach(() => {
  content = new ContentService(new InMemoryContentStore());
  mcp = new McpService(content);
});

const topic = (title: string, extra: Record<string, unknown> = {}) => run('create_topic', { title, summary: `${title} summary`, ...extra });

describe('search_topics and find_gaps', () => {
  it('filters by words and kind, caps the limit, and truncates summaries', async () => {
    await topic('Oil money', { tags: ['oil'], summary: 'x'.repeat(500) });
    await topic('Coal orders', { kind: 'organization' });
    await topic('Oil lobby', { kind: 'person', tags: ['Oil'] });
    expect((await run('search_topics')).total).toBe(3);
    expect((await run('search_topics', { query: 'oil' })).total).toBe(2);
    expect((await run('search_topics', { query: 'oil', kind: 'person' })).topics.map((t: { title: string }) => t.title)).toEqual(['Oil lobby']);
    const limited = await run('search_topics', { query: 'oil', limit: 1 });
    expect(limited).toMatchObject({ total: 2 });
    expect(limited.topics).toHaveLength(1);
    expect(limited.topics[0].summary.length).toBeLessThanOrEqual(300);
    expect((await run('search_topics', { limit: 'lots' })).topics).toHaveLength(3); // junk limit falls back to the default
    expect((await run('search_topics', { limit: 0 })).topics).toHaveLength(3);
  });

  it('lists what still needs work, exempting theses from needing sources', async () => {
    const a = await topic('Alpha');
    await topic('Thesis', { kind: 'thesis' });
    await run('add_reference', { topicId: a.id, label: 'NPR' });
    const gaps = await run('find_gaps');
    expect(gaps.sourcesMissingUrl).toEqual([{ topicId: a.id, referenceId: expect.any(String), label: 'NPR' }]);
    expect(gaps.topicsWithoutSources).toEqual([]);
    expect(gaps.topicsWithoutPerspectives.map((t: { id: string }) => t.id)).toEqual([a.id, 'thesis']);
    expect(gaps.topicsWithoutLinks).toHaveLength(2);
    expect(gaps.draftsAwaitingReview).toBe(3);
  });
});

describe('list_outlets', () => {
  it('ranks a paywalled outlet last and marks it a hard avoid', async () => {
    await run('create_outlet', { name: 'CNN', domain: 'cnn.com', paywall: true, accuracy: 'high', bias: 'low', oneSided: false, factual: 'high' });
    await run('create_outlet', { name: 'NPR', domain: 'www.npr.org', paywall: false, accuracy: 'high', bias: 'low', oneSided: false, factual: 'high' });
    const listed = await run('list_outlets');
    expect(listed.outlets.map((o: { domain: string; hardAvoid: boolean }) => [o.domain, o.hardAvoid])).toEqual([
      ['npr.org', false],
      ['cnn.com', true],
    ]);
  });
});

describe('add_points', () => {
  it('appends to an existing section or creates one, keeping the topic’s other fields', async () => {
    const a = await topic('Alpha', { tags: ['x'] });
    const ref = (await run('add_reference', { topicId: a.id, label: 'NPR' })).added.id;
    await run('add_points', { topicId: a.id, sectionLabel: 'Facts', points: [{ text: 'One.', refIds: [ref] }] });
    const second = await run('add_points', { topicId: a.id, sectionLabel: 'Facts', points: [{ text: 'Two.' }] });
    expect(second.sections).toEqual([{ label: 'Facts', points: 2 }]);
    const other = await run('add_points', { topicId: a.id, sectionLabel: 'Context', points: [{ text: 'Three.' }] });
    expect(other.sections).toEqual([{ label: 'Facts', points: 2 }, { label: 'Context', points: 1 }]);
    const full = await run('get_topic', { id: a.id });
    expect(full.topic).toMatchObject({ tags: ['x'], status: 'draft' });
    expect(full.topic.sections[0].points[0].refIds).toEqual([ref]);
    expect(full.topic.sections[0].points[1].refIds).toEqual([]);
  });

  it('refuses an empty or missing points list', async () => {
    const a = await topic('Alpha');
    await expect(run('add_points', { topicId: a.id, sectionLabel: 'S', points: [] })).rejects.toThrow(/must not be empty/);
    await expect(run('add_points', { topicId: a.id, sectionLabel: 'S' })).rejects.toThrow(/must not be empty/);
    await expect(run('add_points', { topicId: 'nope', sectionLabel: 'S', points: [{ text: 'x' }] })).rejects.toThrow(/No topic/);
  });
});

describe('audit_content and apply_audit_fixes', () => {
  it('returns one compact line per issue, pages, and scopes by ids and codes', async () => {
    const a = await topic('Alpha &amp; Omega', { summary: 'Tom &amp; Jerry  did it.', tags: ['oil&amp;gas'] });
    await topic('Beta', { summary: 'Clean.' });
    await run('add_points', { topicId: a.id, sectionLabel: 'Facts', points: [{ text: 'Trumpâ€™s claim.' }] });

    const report = await run('audit_content', { categories: ['text'] });
    expect(report.scanned.topics).toBe(2);
    expect(report.total).toBeGreaterThanOrEqual(4);
    expect(report.counts.ENC_HTML_ENTITY).toBeGreaterThanOrEqual(2);
    expect(report.lines.join('\n')).toContain('MOJIBAKE');
    for (const line of report.lines) expect(line).toMatch(/^[^|]+\| (topic|reference|perspective|relation|outlet|page):/);

    const paged = await run('audit_content', { categories: ['text'], limit: 1 });
    expect(paged.lines).toHaveLength(1);
    expect(paged.nextOffset).toBe(1);
    const rest = await run('audit_content', { categories: ['text'], limit: 1, offset: paged.nextOffset });
    expect(rest.lines[0]).not.toBe(paged.lines[0]);

    const scoped = await run('audit_content', { ids: [a.id], categories: ['text'] });
    expect(scoped.lines.every((l: string) => l.startsWith(`${a.id} |`))).toBe(true);
    expect((await run('audit_content', { ids: ['nope'] })).total).toBe(0);
    expect((await run('audit_content', { codes: ['MOJIBAKE'] })).lines).toHaveLength(1);
    expect((await run('audit_content', { status: 'published', categories: ['text'] })).total).toBe(0);
  });

  it('applies only high-confidence text repairs, preserving status, and is idempotent', async () => {
    const a = await topic('Alpha &amp; Omega', { summary: 'Tom &amp; Jerry  did it.', tags: ['oil&amp;gas'] });
    const ref = (await run('add_reference', { topicId: a.id, label: 'NPR', excerpt: 'the \\"quote\\" from cafÃ©' })).added;
    await run('add_points', { topicId: a.id, sectionLabel: 'Facts', points: [{ text: 'Uncited and â€œdirtyâ€ point.' }] });
    await run('publish_topic', { topicId: a.id });

    const applied = await run('apply_audit_fixes', { ids: [a.id] });
    expect(applied.fixed.length).toBeGreaterThanOrEqual(4);
    expect(applied.skipped).toEqual([]);
    expect(applied.remainingFixable).toBe(0);

    const full = await run('get_topic', { id: a.id });
    expect(full.topic).toMatchObject({ title: 'Alpha & Omega', summary: 'Tom & Jerry did it.', tags: ['oil&gas'], status: 'published' });
    expect(full.topic.sections[0].points[0].text).toBe('Uncited and “dirty” point.');
    expect(full.references[0]).toMatchObject({ id: ref.id, excerpt: 'the "quote" from café', status: 'published' });

    // Structure findings are reported, never auto-fixed.
    const structure = await run('audit_content', { ids: [a.id], categories: ['structure'] });
    expect(structure.lines.join('\n')).toContain('POINT_NO_CITATION');
    expect(await run('apply_audit_fixes', { ids: [a.id] })).toMatchObject({ fixed: [], remainingFixable: 0 });
  });

  it('repairs relation notes, outlet notes and page working copies, honoring the field limit', async () => {
    const a = await topic('Alpha');
    const b = await topic('Beta');
    await run('link_topics', { fromId: a.id, toId: b.id, kind: 'related', note: 'cafÃ©  link' });
    await run('create_outlet', { name: 'NPR', domain: 'npr.org', paywall: false, accuracy: 'high', bias: 'low', oneSided: false, factual: 'high', note: 'solid  outlet' });
    await run('update_page', { id: 'home', body: 'Body &amp; soul\\ntext' });

    const one = await run('apply_audit_fixes', { limit: 1 });
    expect(one.fixed).toHaveLength(1);
    const rest = await run('apply_audit_fixes', {});
    expect(one.fixed.join('\n') + rest.fixed.join('\n')).toContain('relation:');
    expect(rest.fixed.join('\n')).toContain('outlet:');
    expect(rest.fixed.join('\n')).toContain('page:home');
    expect(rest.remainingFixable).toBe(0);
    expect((await run('get_topic', { id: a.id })).related[0].relation.note).toBe('café link');
    expect((await run('get_page', { id: 'home' })).body).toBe('Body & soul\ntext');
    expect((await run('list_outlets')).outlets[0].note).toBe('solid outlet');
  });

  it('rejects malformed audit arguments', async () => {
    await expect(run('audit_content', { status: 'live' })).rejects.toThrow(/status must be/);
    await expect(run('audit_content', { categories: ['bogus'] })).rejects.toThrow(/categories must be/);
    await expect(run('audit_content', { codes: ['NOPE'] })).rejects.toThrow(/codes must be/);
    await expect(run('audit_content', { ids: 'alpha' })).rejects.toThrow(/ids must be/);
    await expect(run('audit_content', { ids: [''] })).rejects.toThrow(/ids must be/);
    await expect(run('apply_audit_fixes', { staleDays: 'soon' })).resolves.toBeDefined(); // junk numbers fall back, never crash
  });
});

describe('attach_document and attachment tools', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7 signed addendum');
  const sha = createHash('sha256').update(pdf).digest('hex');
  let archive: InMemoryArchive;
  let fetched: string[];
  let reply: BinaryResponse;
  let tools: McpService;
  const call = (name: string, args: Record<string, unknown> = {}) => tools.call(name, args, 'tester (mcp)') as Promise<any>;

  beforeEach(async () => {
    archive = new InMemoryArchive();
    fetched = [];
    reply = { status: 200, headers: { 'content-type': 'application/pdf' }, bytes: pdf };
    tools = new McpService(content, archive, async (url) => (fetched.push(url), reply));
    await run('create_outlet', { name: 'Justice Dept', domain: 'justice.gov', paywall: false, accuracy: 'high', bias: 'low', oneSided: false, factual: 'high' });
    await run('set_status', { status: 'published', items: [{ type: 'outlet', id: 'justice-gov' }] });
  });

  const setup = async () => {
    const a = await topic('Alpha');
    const ref = (await run('add_reference', { topicId: a.id, label: 'DOJ addendum' })).added.id;
    return { a, ref };
  };
  const attach = (referenceId: string, over: Record<string, unknown> = {}) =>
    call('attach_document', { referenceId, url: 'https://www.justice.gov/media/addendum.pdf', caption: 'Signed addendum', altText: 'A signed page', capturedAt: '2026-10-01', ...over });

  it('archives the file, hashes it, and creates a draft attachment from what the server saw', async () => {
    const { a, ref } = await setup();
    const done = await attach(ref);
    expect(fetched).toEqual(['https://www.justice.gov/media/addendum.pdf']);
    expect(done.added).toMatchObject({ sha256: sha, mimeType: 'application/pdf', bytes: pdf.byteLength, extraction: 'pending' });
    expect(done.attachments).toEqual([{ id: done.added.id, referenceId: ref, kind: 'primary-document', caption: 'Signed addendum', extraction: 'pending', status: 'draft' }]);
    expect(archive.files.get(`attachments/${sha}`)).toBeDefined();
    const stored = (await run('get_topic', { id: a.id })).attachments[0];
    expect(stored).toMatchObject({ sha256: sha, sourceUrl: 'https://www.justice.gov/media/addendum.pdf', capturedAt: '2026-10-01', altText: 'A signed page', status: 'draft' });
    expect((await run('list_drafts')).drafts.some((d: { type: string }) => d.type === 'attachment')).toBe(true);
    expect((await run('find_gaps')).attachmentsNeedingText).toEqual([{ topicId: a.id, attachmentId: done.added.id, caption: 'Signed addendum' }]);
  });

  it('reads a plain-text file immediately, takes a kind, and defaults the capture date to today', async () => {
    const { ref } = await setup();
    reply = { status: 200, headers: { 'content-type': 'text/plain' }, bytes: new TextEncoder().encode('Exact words.') };
    const done = await attach(ref, { kind: 'chart', capturedAt: undefined });
    expect(done.added.extraction).toBe('done');
    expect(done.attachments[0]).toMatchObject({ kind: 'chart', extraction: 'done' });
    expect((await run('find_gaps')).attachmentsNeedingText).toEqual([]);
  });

  it('refuses before any fetch: unknown reference, viral claim, untrusted host, bad arguments', async () => {
    const { a, ref } = await setup();
    const viral = (await run('add_reference', { topicId: a.id, label: 'Viral post', viralClaim: true, verdict: 'False.' })).references.find((r: { label: string }) => r.label === 'Viral post').id;
    await expect(attach('ref_nope')).rejects.toThrow(/No reference/);
    await expect(attach(viral)).rejects.toThrow(/never attached/);
    await expect(attach(ref, { url: 'https://example.com/a.pdf' })).rejects.toThrow(/not a trusted source/);
    await expect(attach(ref, { url: 'http://justice.gov/a.pdf' })).rejects.toThrow(/https/);
    await expect(attach(ref, { kind: 'screenshot' })).rejects.toThrow(/kind/);
    await expect(attach(ref, { caption: '' })).rejects.toThrow(/caption/);
    await expect(attach(ref, { altText: undefined })).rejects.toThrow(/altText is required/);
    await expect(attach(ref, { capturedAt: 'yesterday' })).rejects.toThrow(/YYYY-MM-DD/);
    expect(fetched).toEqual([]);
    expect(archive.files.size).toBe(0);
  });

  it('refuses a file that fails the fetch checks, and the same file twice on one reference', async () => {
    const { ref } = await setup();
    reply = { status: 200, headers: { 'content-type': 'text/html' }, bytes: pdf };
    await expect(attach(ref)).rejects.toThrow(/cannot be archived/);
    reply = { status: 200, headers: { 'content-type': 'application/pdf' }, bytes: pdf };
    await attach(ref);
    await expect(attach(ref)).rejects.toThrow(/already attached/);
    expect((await run('find_gaps')).attachmentsNeedingText).toHaveLength(1);
  });

  it('says so when this stage has no archive', async () => {
    const { ref } = await setup();
    const bare = new McpService(content);
    await expect(bare.call('attach_document', { referenceId: ref, url: 'https://justice.gov/a.pdf', caption: 'c', altText: 'a' }, 'tester')).rejects.toThrow(/not configured/);
  });

  it('edits only the human fields through update_attachment, and a transcription finishes the extraction', async () => {
    const { a, ref } = await setup();
    const id = (await attach(ref)).added.id;
    const schema = tools.listTools().find((t) => t.name === 'update_attachment')!.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.required).toEqual(['topicId', 'attachmentId']);
    for (const owned of ['sha256', 'mimeType', 'bytes', 'capturedAt', 'sourceUrl', 'status', 'id']) expect(schema.properties).not.toHaveProperty(owned);
    expect(tools.listTools().map((t) => t.name)).not.toContain('create_attachment');

    // A forged hash is ignored: the tool never offered it.
    const edited = await call('update_attachment', { topicId: a.id, attachmentId: id, caption: 'Retitled', extractedText: 'The addendum reads: continue.', sha256: 'f'.repeat(64) });
    expect(edited.attachments[0]).toMatchObject({ caption: 'Retitled', extraction: 'done' });
    expect((await run('get_topic', { id: a.id })).attachments[0]).toMatchObject({ sha256: sha, altText: 'A signed page', extractedText: 'The addendum reads: continue.' });
    expect((await run('find_gaps')).attachmentsNeedingText).toEqual([]);
    await expect(call('update_attachment', { topicId: a.id, attachmentId: id, kind: 'screenshot' })).rejects.toThrow(/kind/);
    await expect(call('update_attachment', { topicId: a.id, attachmentId: 'nope', caption: 'x' })).rejects.toThrow(/No attachment/);
  });

  it('is a draft you can delete with delete_draft, and goes when its reference does; the archived file stays', async () => {
    const { a, ref } = await setup();
    const first = (await attach(ref)).added.id;
    expect(await call('delete_draft', { type: 'attachment', id: first })).toEqual({ deleted: first, type: 'attachment' });
    expect((await run('get_topic', { id: a.id })).attachments).toEqual([]);

    await attach(ref);
    await call('delete_draft', { type: 'reference', id: ref });
    expect((await run('get_topic', { id: a.id })).attachments).toEqual([]);
    expect(archive.files.has(`attachments/${sha}`)).toBe(true);
  });

  it('publishes with its topic, and shows on the public topic only then', async () => {
    const { a, ref } = await setup();
    await attach(ref);
    const draftView = (await content.index(true)).published().view(a.id);
    expect(draftView).toBeUndefined();
    await run('publish_topic', { topicId: a.id });
    expect((await content.index(true)).published().view(a.id)!.attachments).toHaveLength(1);
  });

  it('tags a viral claim with a verdict instead of attaching it, and refuses an inconsistent one', async () => {
    const { a } = await setup();
    await expect(run('add_reference', { topicId: a.id, label: 'Viral post', viralClaim: true })).rejects.toThrow(/needs a verdict/);
    await expect(run('add_reference', { topicId: a.id, label: 'Post', verdict: 'False.' })).rejects.toThrow(/only goes with a viral claim/);
    const added = await run('add_reference', { topicId: a.id, label: 'Viral post', viralClaim: true, verdict: ' The addendum does not say this. ' });
    expect(added.added).toMatchObject({ viralClaim: true, verdict: 'The addendum does not say this.' });
    const cleared = await run('update_reference', { topicId: a.id, referenceId: added.added.id, viralClaim: false, verdict: '' });
    expect(cleared.references.find((r: { id: string }) => r.id === added.added.id)).toBeDefined();
    expect((await run('get_topic', { id: a.id })).references.find((r: { id: string }) => r.id === added.added.id).viralClaim).toBeUndefined();
  });
});

describe('generated tools', () => {
  it('updates only the fields passed, and refuses invalid values with the field named', async () => {
    const a = await topic('Alpha', { tags: ['keep'] });
    await run('update_topic', { id: a.id, summary: 'New summary' });
    expect((await run('get_topic', { id: a.id })).topic).toMatchObject({ summary: 'New summary', title: 'Alpha', tags: ['keep'] });
    await expect(run('update_topic', { id: a.id, title: 'x' })).rejects.toThrow(/title/);
    await expect(run('create_topic', { title: 'Valid title', summary: 's', sections: [{ label: '', points: [] }] })).rejects.toThrow(/sections\.0\.label/);
    // Arguments the tool doesn't declare are ignored, not stored.
    const created = await run('create_topic', { title: 'Valid title', summary: 's', unknownField: 1, status: 'published' });
    expect(created).toMatchObject({ id: 'valid-title', status: 'draft' });
  });

  it('updates and deletes references and perspectives through their own tools', async () => {
    const a = await topic('Alpha');
    const ref = (await run('add_reference', { topicId: a.id, label: 'NPR' })).added;
    const updated = await run('update_reference', { topicId: a.id, referenceId: ref.id, url: 'https://npr.org/x' });
    expect(updated.references[0]).toMatchObject({ label: 'NPR', url: 'https://npr.org/x' });
    await expect(run('update_reference', { topicId: 'other', referenceId: ref.id, label: 'X' })).rejects.toThrow(/No topic/);
    await expect(run('update_reference', { topicId: a.id, label: 'X' })).rejects.toThrow(/referenceId is required/);
    await expect(run('update_reference', { topicId: a.id, referenceId: 'nope' })).rejects.toThrow(/No reference/);
    const withPerspective = await run('add_perspective', { topicId: a.id, stance: 'official', holder: 'EPA', body: 'Fine.', refIds: [ref.id] });
    const pid = withPerspective.perspectives[0].id;
    await expect(run('add_perspective', { topicId: a.id, stance: 'official', holder: 'EPA', body: 'x', refIds: ['ref_other'] })).rejects.toThrow(/not on this topic/);
    expect((await run('delete_draft', { type: 'perspective', id: pid }))).toEqual({ deleted: pid, type: 'perspective' });
    expect((await run('delete_draft', { type: 'reference', id: ref.id }))).toEqual({ deleted: ref.id, type: 'reference' });
    await expect(run('delete_draft', { type: 'page', id: 'home' })).rejects.toThrow(/type must be one of/);
    await expect(run('delete_draft', { id: 'x' })).rejects.toThrow(/type must be one of/);
    await expect(run('delete_draft', { type: 'topic' })).rejects.toThrow(/id is required/);
  });

  it('links, lists and unlinks topics, in any state', async () => {
    const a = await topic('Alpha');
    const b = await topic('Beta');
    const link = await run('link_topics', { fromId: a.id, toId: b.id, kind: 'related', note: 'n', provenance: 'sourced' });
    expect(link).toMatchObject({ provenance: 'sourced', status: 'draft' });
    await run('set_status', { status: 'published', items: [{ type: 'topic', id: a.id }, { type: 'topic', id: b.id }, { type: 'relation', id: link.id }] });
    expect((await run('list_drafts')).drafts).toEqual([]);
    await expect(run('delete_draft', { type: 'relation', id: link.id })).rejects.toThrow(/published/);
    expect(await run('unlink_topics', { relationId: link.id })).toEqual({ deleted: link.id });
    await expect(run('unlink_topics', { relationId: link.id })).rejects.toThrow(/No relation/);
    await expect(run('set_status', { status: 'published', items: [] })).rejects.toThrow(/items/);
  });

  it('publishes a topic with or without its drafts, and edits site pages', async () => {
    const a = await topic('Alpha');
    await run('add_reference', { topicId: a.id, label: 'NPR' });
    const alone = await run('publish_topic', { topicId: a.id, includeChildren: false });
    expect(alone).toMatchObject({ status: 'published', references: [{ status: 'draft' }] });
    expect((await run('publish_topic', { topicId: a.id })).references[0].status).toBe('published');
    await expect(run('publish_topic', {})).rejects.toThrow(/topicId is required/);

    const left = await topic('Left end');
    const right = await topic('Right end');
    const beyond = await topic('Beyond');
    await run('add_reference', { topicId: right.id, label: 'AP' });
    await run('link_topics', { fromId: left.id, toId: right.id, kind: 'related', note: 'n' });
    await run('link_topics', { fromId: right.id, toId: beyond.id, kind: 'related', note: 'n' });
    const linked = await run('publish_topic', { topicId: left.id, includeLinked: true });
    expect(linked.related[0].status).toBe('published');
    expect((await run('get_topic', { id: right.id })).topic.status).toBe('published');
    expect((await run('get_topic', { id: right.id })).references[0].status).toBe('published');
    expect((await run('get_topic', { id: beyond.id })).topic.status).toBe('draft');

    expect(await run('get_page', { id: 'about' })).toMatchObject({ state: 'default' });
    const edited = await run('update_page', { id: 'about', title: 'About us' });
    expect(edited).toMatchObject({ title: 'About us', state: 'unpublished' });
    expect(edited.body).toContain('GREED documents'); // body kept from the default copy
    await run('update_page', { id: 'about', body: 'Short.' });
    expect(await run('publish_page', { id: 'about' })).toMatchObject({ title: 'About us', body: 'Short.', state: 'published' });
    await expect(run('get_page', { id: 'nope' })).rejects.toThrow(/No page/);
    await expect(run('get_page', {})).rejects.toThrow(/id is required/);
    await expect(run('create_page', { title: 'x', body: 'y' })).rejects.toThrow(/Unknown tool/);
  });

  it('publishes a never-edited page from its default copy', async () => {
    expect(await run('publish_page', { id: 'home' })).toMatchObject({ state: 'published' });
  });

  it('describes every tool with a name, schema and annotations', () => {
    for (const tool of mcp.listTools()) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
    }
  });
});

describe('argument helpers and schema generation', () => {
  it('picks present keys, and requires non-empty strings', () => {
    expect(pick({ a: 1, b: undefined, c: null }, ['a', 'b', 'c', 'd'])).toEqual({ a: 1, c: null });
    expect(requireString({ k: 'v' }, 'k')).toBe('v');
    for (const bad of [{}, { k: '' }, { k: 3 }]) expect(() => requireString(bad, 'k')).toThrow(/k is required/);
  });

  it('validates with the DTO and names nested fields in errors', async () => {
    await expect(dto(TopicInputDto, { title: 'ok title', summary: 's', kind: 'case', sections: [{ label: 'L', points: [{ text: 1 }] }], disputed: '', notes: '', tags: [] })).rejects.toThrow(/sections\.0\.points\.0\.text|points/);
    expect((await dto(TopicInputDto, { title: 'ok title', summary: 's', kind: 'case', sections: [], disputed: '', notes: '', tags: [], status: undefined })).title).toBe('ok title');
  });

  it('reads the DTO into a schema: nested items, enums, bounds, optional fields, omissions and partials', () => {
    const full = dtoSchema(TopicInputDto, { omit: ['id', 'status'], defaults: ['kind'], docs: { 'sections.label': 'Heading' } }) as any;
    expect(full.required).toEqual(['title', 'summary', 'sections', 'disputed', 'notes', 'tags']);
    expect(full.properties.id).toBeUndefined();
    expect(full.properties.tags).toMatchObject({ type: 'array', maxItems: 20, items: { type: 'string', maxLength: 40 } });
    expect(full.properties.sections.items.properties.label).toMatchObject({ minLength: 1, maxLength: 200, description: 'Heading' });
    expect(full.properties.sections.items.required).toEqual(['label', 'points']);
    expect(full.properties.sections.maxItems).toBe(50);
    const partial = dtoSchema(TopicInputDto, { partial: true }) as any;
    expect(partial.required).toBeUndefined();
    expect(partial.properties.id.pattern).toContain('a-z0-9');
    expect(dtoKeys(TopicInputDto)).toEqual(expect.arrayContaining(['id', 'kind', 'status']));
  });
});
