import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import fastifyCookie from '@fastify/cookie';
import { AuthService, UsersService, type User } from '@bubltec/mycota-auth';
import { InMemoryContentStore, type Attachment, type Reference, type Topic } from '@greed/domain';
import { AppModule } from '../app.module.js';
import { ARCHIVE, InMemoryArchive, archiveKey } from '../archive/archive.js';
import { VALIDATION_PIPE_OPTIONS } from '../validation.js';
import { CONTENT_STORE } from './content.tokens.js';

/** The file endpoint and the editor REST routes for attachments, through the real HTTP stack. */
const at = '2026-01-01T00:00:00.000Z';
const topic = (id: string, status: 'draft' | 'published'): Topic => ({
  id, kind: 'case', title: `Topic ${id}`, summary: '', sections: [], disputed: '', notes: '', tags: [], createdAt: at, updatedAt: at, status,
});
const ref = (id: string, topicId: string, status: 'draft' | 'published'): Reference => ({ id, topicId, label: 'DOJ', status, createdAt: at, updatedAt: at });
const sha = (c: string) => c.repeat(64);
const att = (id: string, over: Partial<Attachment> = {}): Attachment => ({
  id, topicId: 'live', referenceId: 'r-live', kind: 'scan', caption: `Caption ${id}`, altText: 'Alt', capturedAt: '2026-10-01', sha256: sha('a'), mimeType: 'application/pdf', bytes: 5,
  extractionStatus: 'pending', status: 'published', createdAt: at, updatedAt: at, ...over,
});

const users = new Map<string, User>();
const fakeUsers = {
  getByProviderAccount: async (p: string, id: string) => users.get(`${p}:${id}`) ?? null,
  findOrCreateByEmail: async (email: string) => {
    const user: User = { id: `u_${email}`, provider: 'email', providerAccountId: email, displayName: email.split('@')[0]!, email, verifiedContributor: false, createdAt: at };
    users.set(`email:${email}`, user);
    return user;
  },
};

let app: NestFastifyApplication;
let editor: string;
const archive = new InMemoryArchive();

beforeAll(async () => {
  process.env.STAGE = 'test';
  process.env.EDITORS = 'john@example.com';
  await archive.put(archiveKey(sha('a')), { bytes: new TextEncoder().encode('%PDF live'), mimeType: 'application/pdf' });
  await archive.put(archiveKey(sha('b')), { bytes: new TextEncoder().encode('draft file'), mimeType: 'image/png' });
  const store = new InMemoryContentStore({
    topics: [topic('live', 'published'), topic('wip', 'draft')],
    references: [ref('r-live', 'live', 'published'), ref('r-wip', 'wip', 'draft')],
    attachments: [
      att('published-file'),
      att('draft-file', { status: 'draft', sha256: sha('b'), mimeType: 'image/png' }),
      att('hidden-topic', { topicId: 'wip', referenceId: 'r-wip', status: 'published' }),
      att('lost-file', { sha256: sha('c') }),
    ],
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONTENT_STORE).useValue(store)
    .overrideProvider(ARCHIVE).useValue(archive)
    .overrideProvider(UsersService).useValue(fakeUsers)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.register(fastifyCookie);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  editor = `greed_session=${app.get(AuthService).issueSessionToken(await fakeUsers.findOrCreateByEmail('john@example.com'))}`;
});

afterAll(async () => {
  await app?.close();
});

const get = (url: string, cookie?: string) => app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

describe('GET /api/attachments/:id/file', () => {
  it('serves a published file with its stored type, locked down so it cannot be sniffed or scripted', async () => {
    const res = await get('/api/attachments/published-file/file');
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('%PDF live');
    expect(res.headers).toMatchObject({
      'content-type': 'application/pdf',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'public, max-age=300',
    });
  });

  it('never gives a draft file, or one on a draft topic, to the public; an editor previews them uncached', async () => {
    for (const id of ['draft-file', 'hidden-topic']) {
      expect((await get(`/api/attachments/${id}/file`)).statusCode).toBe(404);
      expect((await get(`/api/attachments/${id}/file?preview=1`)).statusCode).toBe(404); // preview needs an editor
    }
    const preview = await get('/api/attachments/draft-file/file?preview=1', editor);
    expect(preview.statusCode).toBe(200);
    expect(preview.headers).toMatchObject({ 'content-type': 'image/png', 'cache-control': 'private, no-store' });
    expect(preview.body).toBe('draft file');
  });

  it('is a 404 for an unknown id or a row whose file is not in the archive', async () => {
    expect((await get('/api/attachments/nope/file')).statusCode).toBe(404);
    expect((await get('/api/attachments/lost-file/file')).statusCode).toBe(404);
  });
});

describe('public reads and editor routes', () => {
  it('shows published evidence on the public topic and in the export, never a draft', async () => {
    const view = (await get('/api/topics/live')).json();
    expect(view.attachments.map((a: Attachment) => a.id).sort()).toEqual(['lost-file', 'published-file']);
    const exported = (await get('/api/export')).json();
    expect(exported.attachments.map((a: Attachment) => a.id).sort()).toEqual(['lost-file', 'published-file']);
    const preview = (await get('/api/topics/live?preview=1', editor)).json();
    expect(preview.attachments.map((a: Attachment) => a.id)).toContain('draft-file');
  });

  it('has no REST create (only the server archives files), but lets an editor correct the human fields', async () => {
    const create = await app.inject({
      method: 'POST', url: '/api/topics/live/attachments', headers: { cookie: editor },
      payload: { referenceId: 'r-live', kind: 'scan', caption: 'x', altText: 'y', sha256: sha('d'), mimeType: 'application/pdf', bytes: 1, capturedAt: '2026-10-01' },
    });
    expect(create.statusCode).toBe(404);

    const url = '/api/topics/live/attachments/published-file';
    const body = { referenceId: 'r-live', kind: 'chart', caption: 'Corrected caption', altText: 'Corrected alt', sha256: sha('f'), mimeType: 'text/html', bytes: 1, extractedText: 'Exact words.' };
    expect((await app.inject({ method: 'PUT', url, payload: body })).statusCode).toBe(401);
    const updated = await app.inject({ method: 'PUT', url, headers: { cookie: editor }, payload: body });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().attachments.find((a: Attachment) => a.id === 'published-file')).toMatchObject({
      caption: 'Corrected caption', kind: 'chart', sha256: sha('a'), mimeType: 'application/pdf', bytes: 5, extractionStatus: 'done',
    });
    const invalid = await app.inject({ method: 'PUT', url, headers: { cookie: editor }, payload: { ...body, sha256: 'not-a-hash' } });
    expect(invalid.statusCode).toBe(400);
    const unknownField = await app.inject({ method: 'PUT', url, headers: { cookie: editor }, payload: { ...body, storageKey: '../../etc/passwd' } });
    expect(unknownField.statusCode).toBe(400);
  });
});
