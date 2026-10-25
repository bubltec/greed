import { describe, expect, it } from 'vitest';
import { InMemoryContentStore, type PageView, type Topic, type TopicView } from '@greed/domain';
import { ContentService } from './content.service.js';
import type { TopicInputDto } from './content.dto.js';

const at = '2026-01-01T00:00:00.000Z';
const seedTopic = (id: string): Topic => ({
  id,
  kind: 'case',
  title: `Topic ${id}`,
  summary: '',
  sections: [],
  disputed: '',
  notes: '',
  tags: [],
  createdAt: at,
  updatedAt: at,
});

const input = (overrides: Partial<TopicInputDto> = {}): TopicInputDto => ({
  kind: 'case',
  title: 'Oil money in the midterms',
  summary: 'Summary',
  sections: [],
  disputed: '',
  notes: '',
  tags: [' Oil ', 'oil', 'Elections'],
  ...overrides,
});

function service() {
  return new ContentService(new InMemoryContentStore({ topics: [seedTopic('a'), seedTopic('b')] }));
}

const topicView = async (svc: ContentService, id: string) => (await svc.get('topic', id)) as TopicView;
const createTopic = async (svc: ContentService, overrides: Partial<TopicInputDto> = {}) =>
  (await svc.create('topic', input(overrides), 'ed')).result as TopicView;
const addRef = async (svc: ContentService, topicId: string, ref: Record<string, unknown>) =>
  (await svc.create('reference', ref, 'ed', topicId)).result as TopicView;
const addPerspective = async (svc: ContentService, topicId: string, p: Record<string, unknown>) =>
  (await svc.create('perspective', p, 'ed', topicId)).result as TopicView;
const link = async (svc: ContentService, rel: Record<string, unknown>) => (await svc.create('relation', rel, 'ed')).item;

describe('ContentService', () => {
  it('creates a topic with a unique slug and normalised tags', async () => {
    const svc = service();
    const first = await createTopic(svc);
    const second = await createTopic(svc);
    expect(first.topic.id).toBe('oil-money-in-the-midterms');
    expect(second.topic.id).toBe('oil-money-in-the-midterms-2');
    expect(first.topic.tags).toEqual(['oil', 'elections']);
    expect(first.topic.updatedBy).toBe('ed');
  });

  it('links points only to references on the same topic', async () => {
    const svc = service();
    const withRef = await addRef(svc, 'a', { label: 'NPR', url: 'https://npr.org/x' });
    const refId = withRef.references[0]!.id;
    const updated = (
      await svc.update(
        'topic',
        { id: 'a' },
        input({
          title: 'Topic a',
          sections: [{ label: 'What happened', points: [{ text: 'It happened.', refIds: [refId, 'ref_other'] }] }],
        }),
        'ed',
      )
    ).result as TopicView;
    expect(updated.topic.sections[0]!.points[0]!.refIds).toEqual([refId]);
    expect(updated.topic.sections[0]!.id).toMatch(/^sec_/);
    expect(updated.topic.createdAt).toBe(at);
  });

  it('unlinks a deleted reference from points and perspectives', async () => {
    const svc = service();
    const refId = (await addRef(svc, 'a', { label: 'NPR' })).references[0]!.id;
    await svc.update('topic', { id: 'a' }, input({ sections: [{ label: 'S', points: [{ text: 'x', refIds: [refId] }] }] }), 'ed');
    await addPerspective(svc, 'a', { stance: 'critic', holder: 'X', body: 'y', refIds: [refId] });
    const after = (await svc.remove('reference', { id: refId, parentId: 'a' }, 'ed')) as TopicView;
    expect(after.references).toEqual([]);
    expect(after.topic.sections[0]!.points[0]!.refIds).toEqual([]);
    expect(after.perspectives[0]!.refIds).toEqual([]);
  });

  it('rejects perspective refs from another topic', async () => {
    const svc = service();
    const refId = (await addRef(svc, 'b', { label: 'NPR' })).references[0]!.id;
    await expect(addPerspective(svc, 'a', { stance: 'critic', holder: 'X', body: 'y', refIds: [refId] })).rejects.toThrow(
      /not on this topic/,
    );
  });

  it('updates a perspective in place, keeping its status and creation date', async () => {
    const svc = service();
    const created = await addPerspective(svc, 'a', { stance: 'critic', holder: 'X', body: 'y', refIds: [], status: 'draft' });
    const id = created.perspectives[0]!.id;
    const updated = (
      await svc.update('perspective', { id, parentId: 'a' }, { stance: 'defender', holder: 'X', body: 'z', refIds: [] }, 'ed')
    ).result as TopicView;
    expect(updated.perspectives).toHaveLength(1);
    expect(updated.perspectives[0]).toMatchObject({ id, stance: 'defender', body: 'z', status: 'draft' });
    await expect(svc.update('perspective', { id, parentId: 'b' }, { stance: 'critic', holder: 'X', body: 'y', refIds: [] }, 'ed')).rejects.toThrow(
      /No perspective/,
    );
  });

  it('guards relations against self, unknown and duplicate links', async () => {
    const svc = service();
    const rel = { fromId: 'a', toId: 'b', kind: 'same-actor' as const, note: 'n' };
    const created = await link(svc, rel);
    expect(created.provenance).toBe('editor');
    await expect(link(svc, { ...rel, fromId: 'b', toId: 'a' })).rejects.toThrow(/already exists/);
    await expect(link(svc, { ...rel, toId: 'a' })).rejects.toThrow(/itself/);
    await expect(link(svc, { ...rel, toId: 'zzz' })).rejects.toThrow(/No topic/);
    // A different kind between the same pair is allowed.
    await link(svc, { ...rel, kind: 'cause-effect' });
    expect((await topicView(svc, 'a')).related).toHaveLength(2);
  });

  it('cascades a topic delete to its references, perspectives and relations', async () => {
    const svc = service();
    await link(svc, { fromId: 'a', toId: 'b', kind: 'related', note: '' });
    await addRef(svc, 'a', { label: 'NPR' });
    await addPerspective(svc, 'a', { stance: 'critic', holder: 'X', body: 'y', refIds: [] });
    expect(await svc.remove('topic', { id: 'a' }, 'ed')).toBeUndefined();
    expect((await topicView(svc, 'b')).related).toEqual([]);
    await expect(topicView(svc, 'a')).rejects.toThrow(/No topic/);
    const { snapshot } = await svc.index(true);
    expect(snapshot.references).toEqual([]);
    expect(snapshot.perspectives).toEqual([]);
  });

  it('deletes drafts but refuses published items', async () => {
    const svc = service();
    const draft = await createTopic(svc, { status: 'draft' });
    const refId = (await addRef(svc, draft.topic.id, { label: 'NPR' })).references[0]!.id;
    await expect(svc.removeDraft('topic', 'a', 'ed')).rejects.toThrow(/published/);
    await expect(svc.removeDraft('reference', 'nope', 'ed')).rejects.toThrow(/No reference/);
    await expect(svc.removeDraft('page', 'home', 'ed')).rejects.toThrow(/no drafts/);
    await svc.removeDraft('reference', refId, 'ed');
    expect((await topicView(svc, draft.topic.id)).references).toEqual([]);
    await svc.removeDraft('topic', draft.topic.id, 'ed');
    await expect(topicView(svc, draft.topic.id)).rejects.toThrow(/No topic/);
    expect((await topicView(svc, 'a')).topic.id).toBe('a');
  });

  it('starts topics as drafts and lets children inherit their topic’s status', async () => {
    const svc = service();
    const created = await createTopic(svc);
    expect(created.topic.status).toBe('draft');
    // Seeded topic `a` has no status, so it counts as published: a new source on it is live.
    const onLive = await addRef(svc, 'a', { label: 'NPR' });
    expect(onLive.references[0]!.status).toBe('published');
    const onDraft = await addRef(svc, created.topic.id, { label: 'AP' });
    expect(onDraft.references[0]!.status).toBe('draft');
    // Explicit status wins (the MCP connector always passes draft).
    const explicit = await addPerspective(svc, 'a', { stance: 'critic', holder: 'X', body: 'y', refIds: [], status: 'draft' });
    expect(explicit.perspectives[0]!.status).toBe('draft');
  });

  it('publishes a topic with its drafts and stamps publishedAt once', async () => {
    const svc = service();
    const { topic } = await createTopic(svc);
    await addRef(svc, topic.id, { label: 'AP' });
    await link(svc, { fromId: topic.id, toId: 'a', kind: 'related', note: '' });
    const view = (await svc.publish('topic', topic.id, 'ed')) as TopicView;
    expect(view.topic.status).toBe('published');
    expect(view.topic.publishedAt).toBeDefined();
    expect(view.references.every((r) => r.status === 'published')).toBe(true);
    expect(view.related[0]!.relation.status).toBe('published');
    const first = view.topic.publishedAt;
    await svc.update('topic', { id: topic.id }, input({ title: 'Renamed' }), 'ed');
    expect((await topicView(svc, topic.id)).topic.publishedAt).toBe(first);
  });

  it('can publish the draft topics a link points at, and does not follow their links', async () => {
    const svc = service();
    const here = (await createTopic(svc, { title: 'Here' })).topic.id;
    const next = (await createTopic(svc, { title: 'Next' })).topic.id;
    const far = (await createTopic(svc, { title: 'Far' })).topic.id;
    await addRef(svc, next, { label: 'AP' });
    await link(svc, { fromId: here, toId: next, kind: 'related', note: '' });
    await link(svc, { fromId: next, toId: far, kind: 'related', note: '' });

    const held = (await svc.publish('topic', here, 'ed')) as TopicView;
    expect(held.topic.status).toBe('published');
    expect(held.related[0]!.relation.status).toBe('draft');
    expect((await topicView(svc, next)).topic.status).toBe('draft');

    const view = (await svc.publish('topic', here, 'ed', { includeLinked: true })) as TopicView;
    expect(view.related[0]!.relation.status).toBe('published');
    const nextView = await topicView(svc, next);
    expect(nextView.topic.status).toBe('published');
    expect(nextView.references[0]!.status).toBe('published');
    expect(nextView.related.find((r) => r.other.id === far)!.relation.status).toBe('draft');
    expect((await topicView(svc, far)).topic.status).toBe('draft');
  });

  it('refuses a status change that names an unknown item, writing nothing', async () => {
    const svc = service();
    await expect(
      svc.setStatus({ status: 'draft', items: [{ type: 'topic', id: 'a' }, { type: 'topic', id: 'nope' }] }, 'ed'),
    ).rejects.toThrow(/No topic "nope"/);
    expect((await topicView(svc, 'a')).topic.status).toBeUndefined();
  });

  it('keeps a site page’s working copy apart from its published copy', async () => {
    const svc = service();
    const page = (id = 'home') => svc.get('page', id) as Promise<PageView>;
    expect((await page()).state).toBe('default');
    expect(((await svc.update('page', { id: 'home' }, { title: 'T', body: 'B' }, 'ed')).result as PageView).state).toBe('unpublished');
    expect((await svc.page('home', false)).state).toBe('default');
    expect(((await svc.publish('page', 'home', 'ed')) as PageView).state).toBe('published');
    expect((await svc.page('home', false)).title).toBe('T');
    await svc.update('page', { id: 'home' }, { title: 'T2', body: 'B' }, 'ed');
    expect((await page()).state).toBe('changed');
    expect((await svc.page('home', false)).title).toBe('T');
    // Pages have fixed ids: no creating, deleting or unknown ids.
    await expect(svc.create('page', { title: 'x', body: 'y' }, 'ed')).rejects.toThrow(/can't be created/);
    await expect(svc.remove('page', { id: 'home' }, 'ed')).rejects.toThrow(/can't be deleted/);
    await expect(svc.update('page', { id: 'nope' }, { title: 'x', body: 'y' }, 'ed')).rejects.toThrow(/No page/);
  });

  it('records an outlet under its domain and refuses a duplicate or a non-host', async () => {
    const svc = service();
    const input = {
      name: 'NPR',
      domain: 'https://www.npr.org/news',
      paywall: false,
      accuracy: 'high',
      bias: 'low',
      oneSided: false,
      factual: 'high',
    };
    const created = (await svc.create('outlet', input, 'ed')).item as { id: string; domain: string; status?: string };
    expect(created).toMatchObject({ id: 'npr-org', domain: 'npr.org', status: 'draft' });
    await expect(svc.create('outlet', { ...input, name: 'National Public Radio' }, 'ed')).rejects.toThrow(/already exists/);
    await expect(svc.create('outlet', { ...input, domain: 'not a host' }, 'ed')).rejects.toThrow(/Not a domain/);
    const updated = await svc.update('outlet', { id: 'npr-org' }, { ...input, paywall: true, domain: 'npr.org', note: '  radio  ' }, 'ed');
    expect(updated.item).toMatchObject({ paywall: true, note: 'radio' });
    const cleared = await svc.update('outlet', { id: 'npr-org' }, { ...input, domain: 'npr.org', note: '   ' }, 'ed');
    expect((cleared.item as unknown as { note?: string }).note).toBeUndefined();
  });
});

describe('attachments and viral claims', () => {
  const SHA = 'a'.repeat(64);
  const file = { kind: 'scan', caption: ' Signed addendum ', altText: ' A signed page ', sourceUrl: 'https://justice.gov/a.pdf', capturedAt: '2026-10-01', sha256: SHA, mimeType: 'application/pdf', bytes: 10 };
  const attachments = async (svc: ContentService) => (await svc.index(true)).snapshot.attachments ?? [];
  const addAttachment = (svc: ContentService, topicId: string, referenceId: string, over: Record<string, unknown> = {}) =>
    svc.create('attachment', { ...file, referenceId, ...over }, 'ed', topicId);

  async function withRef() {
    const svc = service();
    const refId = (await addRef(svc, 'a', { label: 'DOJ', url: 'https://justice.gov/x' })).references[0]!.id;
    return { svc, refId };
  }

  it('stores an attachment for a reference, trimmed, taking its topic’s status, and shows it on the topic view', async () => {
    const { svc, refId } = await withRef();
    const { item } = await addAttachment(svc, 'a', refId);
    // The seeded topic is published, so the evidence inherits that unless a status is given.
    expect(item).toMatchObject({ topicId: 'a', referenceId: refId, caption: 'Signed addendum', altText: 'A signed page', sha256: SHA, status: 'published', extractionStatus: 'pending', updatedBy: 'ed' });
    expect((await addAttachment(svc, 'a', refId, { sha256: 'd'.repeat(64), status: 'draft' })).item.status).toBe('draft');
    expect((await topicView(svc, 'a')).attachments).toHaveLength(2);
  });

  it('refuses a reference from another topic, an unknown one, and a viral claim', async () => {
    const { svc, refId } = await withRef();
    const other = (await addRef(svc, 'b', { label: 'AP' })).references[0]!.id;
    await expect(addAttachment(svc, 'a', other)).rejects.toThrow(/not on this topic/);
    await expect(addAttachment(svc, 'a', 'ref_nope')).rejects.toThrow(/not on this topic/);
    const viral = (await addRef(svc, 'a', { label: 'Viral post', viralClaim: true, verdict: 'False.' })).references.find((r) => r.label === 'Viral post')!;
    await expect(addAttachment(svc, 'a', viral.id)).rejects.toThrow(/never attached/);
    expect(await attachments(svc)).toEqual([]);
    expect(refId).toBeDefined();
  });

  it('needs the facts only the server can vouch for, and refuses the same file twice on one reference', async () => {
    const { svc, refId } = await withRef();
    for (const missing of ['sha256', 'mimeType', 'bytes', 'capturedAt']) {
      await expect(addAttachment(svc, 'a', refId, { [missing]: undefined })).rejects.toThrow(/attach_document/);
    }
    const first = (await addAttachment(svc, 'a', refId)).item;
    await expect(addAttachment(svc, 'a', refId)).rejects.toThrow(new RegExp(`already attached to this reference \\(${first.id}\\)`));
    // The same file may back a different reference, and a different file the same one.
    const second = (await addRef(svc, 'a', { label: 'Court order' })).references.find((r) => r.label === 'Court order')!;
    await expect(addAttachment(svc, 'a', second.id)).resolves.toBeDefined();
    await expect(addAttachment(svc, 'a', refId, { sha256: 'b'.repeat(64) })).resolves.toBeDefined();
  });

  it('edits only the human fields: the archived facts cannot change, and text marks the extraction done', async () => {
    const { svc, refId } = await withRef();
    const { id } = (await addAttachment(svc, 'a', refId)).item;
    const edited = (
      await svc.update(
        'attachment',
        { id, parentId: 'a' },
        { ...file, referenceId: refId, caption: 'Retitled', altText: 'Alt', sha256: 'f'.repeat(64), mimeType: 'text/html', bytes: 1, capturedAt: '2020-01-01', sourceUrl: 'https://evil.example/x', extractedText: '  The addendum reads: continue.  ' },
        'ed',
      )
    ).item;
    expect(edited).toMatchObject({
      caption: 'Retitled', sha256: SHA, mimeType: 'application/pdf', bytes: 10, capturedAt: '2026-10-01', sourceUrl: 'https://justice.gov/a.pdf',
      extractedText: 'The addendum reads: continue.', extractionStatus: 'done',
    });
    const failed = (await svc.update('attachment', { id, parentId: 'a' }, { ...file, referenceId: refId, caption: 'c', altText: 'a', extractedText: 'x', extractionStatus: 'failed' }, 'ed')).item;
    expect(failed.extractionStatus).toBe('failed');
    const cleared = (await svc.update('attachment', { id, parentId: 'a' }, { ...file, referenceId: refId, caption: 'c', altText: 'a' }, 'ed')).item as unknown as { extractedText?: string; extractionStatus: string };
    expect(cleared.extractedText).toBeUndefined();
    expect(cleared.extractionStatus).toBe('failed'); // no new text, no status given: unchanged
    // Moving it to another reference is allowed on the same topic only.
    const second = (await addRef(svc, 'a', { label: 'Court order' })).references.find((r) => r.label === 'Court order')!;
    await expect(svc.update('attachment', { id, parentId: 'a' }, { ...file, referenceId: second.id, caption: 'c', altText: 'a' }, 'ed')).resolves.toBeDefined();
    const otherTopic = (await addRef(svc, 'b', { label: 'AP' })).references[0]!.id;
    await expect(svc.update('attachment', { id, parentId: 'a' }, { ...file, referenceId: otherTopic, caption: 'c', altText: 'a' }, 'ed')).rejects.toThrow(/not on this topic/);
  });

  it('puts a file back in the queue when its text is cleared, since done always means there is text', async () => {
    const { svc, refId } = await withRef();
    const { id } = (await addAttachment(svc, 'a', refId, { extractedText: 'Words.' })).item;
    expect((await attachments(svc))[0]).toMatchObject({ extractionStatus: 'done', extractedText: 'Words.' });
    const row = (await svc.update('attachment', { id, parentId: 'a' }, { ...file, referenceId: refId, caption: 'c', altText: 'a', extractionStatus: 'done' }, 'ed')).item;
    expect(row).toMatchObject({ extractionStatus: 'pending' });
    expect((row as { extractedText?: string }).extractedText).toBeUndefined();
  });

  it('goes with its reference and with its topic, but never deletes the archived file’s row twice', async () => {
    const { svc, refId } = await withRef();
    const keep = (await addRef(svc, 'a', { label: 'Other' })).references.find((r) => r.label === 'Other')!;
    await addAttachment(svc, 'a', refId);
    const kept = (await addAttachment(svc, 'a', keep.id, { sha256: 'c'.repeat(64) })).item;
    await svc.remove('reference', { id: refId, parentId: 'a' }, 'ed');
    expect((await attachments(svc)).map((a) => a.id)).toEqual([kept.id]);
    await svc.remove('topic', { id: 'a' }, 'ed');
    expect(await attachments(svc)).toEqual([]);
  });

  it('publishes with its topic, and can be deleted only while a draft', async () => {
    const svc = service();
    const draftTopic = (await createTopic(svc)).topic.id;
    const refId = (await addRef(svc, draftTopic, { label: 'DOJ' })).references[0]!.id;
    const { id } = (await addAttachment(svc, draftTopic, refId)).item;
    expect((await attachments(svc))[0]!.status).toBe('draft'); // a draft topic's evidence is a draft
    await svc.publish('topic', draftTopic, 'ed');
    expect((await attachments(svc))[0]!.status).toBe('published');
    await expect(svc.removeDraft('attachment', id, 'ed')).rejects.toThrow(/published/);
    await svc.setStatus({ status: 'draft', items: [{ type: 'attachment', id }] }, 'ed');
    await expect(svc.removeDraft('attachment', id, 'ed')).resolves.toEqual({ deleted: id, type: 'attachment' });
  });

  it('requires a verdict for a viral claim, and a viral claim for a verdict', async () => {
    const svc = service();
    await expect(addRef(svc, 'a', { label: 'Post', viralClaim: true })).rejects.toThrow(/needs a verdict/);
    await expect(addRef(svc, 'a', { label: 'Post', viralClaim: true, verdict: '   ' })).rejects.toThrow(/needs a verdict/);
    await expect(addRef(svc, 'a', { label: 'Post', verdict: 'False.' })).rejects.toThrow(/only goes with a viral claim/);
    const ref = (await addRef(svc, 'a', { label: 'Post', viralClaim: true, verdict: ' Not in the addendum. ' })).references[0]!;
    expect(ref).toMatchObject({ viralClaim: true, verdict: 'Not in the addendum.' });
    const plain = (await addRef(svc, 'a', { label: 'NPR', viralClaim: false })).references.find((r) => r.label === 'NPR')!;
    expect(plain.viralClaim).toBeUndefined();
    expect(plain.verdict).toBeUndefined();
  });

  it('will not mark a reference viral once evidence is attached to it', async () => {
    const { svc, refId } = await withRef();
    await addAttachment(svc, 'a', refId);
    await expect(svc.update('reference', { id: refId, parentId: 'a' }, { label: 'DOJ', viralClaim: true, verdict: 'x' }, 'ed')).rejects.toThrow(/archived evidence/);
    await expect(svc.update('reference', { id: refId, parentId: 'a' }, { label: 'DOJ renamed' }, 'ed')).resolves.toBeDefined();
  });
});
