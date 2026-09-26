import { describe, expect, it } from 'vitest';
import { InMemoryContentStore, type Topic } from '@greed/domain';
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

describe('ContentService', () => {
  it('creates a topic with a unique slug and normalised tags', async () => {
    const svc = service();
    const first = await svc.createTopic(input(), 'ed');
    const second = await svc.createTopic(input(), 'ed');
    expect(first.topic.id).toBe('oil-money-in-the-midterms');
    expect(second.topic.id).toBe('oil-money-in-the-midterms-2');
    expect(first.topic.tags).toEqual(['oil', 'elections']);
    expect(first.topic.updatedBy).toBe('ed');
  });

  it('links points only to references on the same topic', async () => {
    const svc = service();
    const withRef = await svc.saveReference('a', undefined, { label: 'NPR', url: 'https://npr.org/x' }, 'ed');
    const refId = withRef.references[0]!.id;
    const updated = await svc.updateTopic(
      'a',
      input({
        title: 'Topic a',
        sections: [{ label: 'What happened', points: [{ text: 'It happened.', refIds: [refId, 'ref_other'] }] }],
      }),
      'ed',
    );
    expect(updated.topic.sections[0]!.points[0]!.refIds).toEqual([refId]);
    expect(updated.topic.sections[0]!.id).toMatch(/^sec_/);
    expect(updated.topic.createdAt).toBe(at);
  });

  it('unlinks a deleted reference from points and perspectives', async () => {
    const svc = service();
    const refId = (await svc.saveReference('a', undefined, { label: 'NPR' }, 'ed')).references[0]!.id;
    await svc.updateTopic(
      'a',
      input({ sections: [{ label: 'S', points: [{ text: 'x', refIds: [refId] }] }] }),
      'ed',
    );
    await svc.savePerspective('a', undefined, { stance: 'critic', holder: 'X', body: 'y', refIds: [refId] }, 'ed');
    const after = await svc.deleteReference('a', refId, 'ed');
    expect(after.references).toEqual([]);
    expect(after.topic.sections[0]!.points[0]!.refIds).toEqual([]);
    expect(after.perspectives[0]!.refIds).toEqual([]);
  });

  it('rejects perspective refs from another topic', async () => {
    const svc = service();
    const refId = (await svc.saveReference('b', undefined, { label: 'NPR' }, 'ed')).references[0]!.id;
    await expect(
      svc.savePerspective('a', undefined, { stance: 'critic', holder: 'X', body: 'y', refIds: [refId] }, 'ed'),
    ).rejects.toThrow(/not on this topic/);
  });

  it('guards relations against self, unknown and duplicate links', async () => {
    const svc = service();
    const rel = { fromId: 'a', toId: 'b', kind: 'same-actor' as const, note: 'n' };
    const created = await svc.saveRelation(undefined, rel, 'ed');
    expect(created.provenance).toBe('editor');
    await expect(svc.saveRelation(undefined, { ...rel, fromId: 'b', toId: 'a' }, 'ed')).rejects.toThrow(/already exists/);
    await expect(svc.saveRelation(undefined, { ...rel, toId: 'a' }, 'ed')).rejects.toThrow(/itself/);
    await expect(svc.saveRelation(undefined, { ...rel, toId: 'zzz' }, 'ed')).rejects.toThrow(/No topic/);
    // A different kind between the same pair is allowed.
    await svc.saveRelation(undefined, { ...rel, kind: 'cause-effect' }, 'ed');
    expect((await svc.view('a')).related).toHaveLength(2);
  });

  it('cascades a topic delete to its relations', async () => {
    const svc = service();
    await svc.saveRelation(undefined, { fromId: 'a', toId: 'b', kind: 'related', note: '' }, 'ed');
    await svc.deleteTopic('a');
    expect((await svc.view('b', true)).related).toEqual([]);
    await expect(svc.view('a', true)).rejects.toThrow(/No topic/);
  });
});
