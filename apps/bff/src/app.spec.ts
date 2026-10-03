import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import fastifyCookie from '@fastify/cookie';
import { AuthService, UsersService, type User } from '@bubltec/mycota-auth';
import { InMemoryContentStore } from '@greed/domain';
import { AppModule } from './app.module.js';
import { CONTENT_STORE } from './content/content.tokens.js';
import { VALIDATION_PIPE_OPTIONS } from './validation.js';

/**
 * Boots the real AppModule (so a Nest or mycota upgrade proves DI still
 * resolves) with the store and users table swapped for in-memory fakes.
 */
const users = new Map<string, User>();
const fakeUsers = {
  getByProviderAccount: async (p: string, id: string) => users.get(`${p}:${id}`) ?? null,
  findOrCreateByEmail: async (email: string) => {
    const user: User = {
      id: `u_${email}`,
      provider: 'email',
      providerAccountId: email,
      displayName: email.split('@')[0]!,
      email,
      verifiedContributor: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    users.set(`email:${email}`, user);
    return user;
  },
};

let app: NestFastifyApplication;
let editorCookie: string;
let strangerCookie: string;

beforeAll(async () => {
  process.env.STAGE = 'test';
  process.env.EDITORS = 'john@example.com';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONTENT_STORE)
    .useValue(new InMemoryContentStore())
    .overrideProvider(UsersService)
    .useValue(fakeUsers)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.register(fastifyCookie);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const auth = app.get(AuthService);
  editorCookie = `greed_session=${auth.issueSessionToken(await fakeUsers.findOrCreateByEmail('john@example.com'))}`;
  strangerCookie = `greed_session=${auth.issueSessionToken(await fakeUsers.findOrCreateByEmail('someone@example.com'))}`;
});

afterAll(async () => {
  await app?.close();
});

const topic = {
  kind: 'case',
  title: 'A documented case',
  summary: 'What happened.',
  sections: [{ label: 'Facts', points: [{ text: 'One.', refIds: [] }] }],
  disputed: '',
  notes: '',
  tags: [],
};

describe('HTTP API', () => {
  it('serves public reads', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/topics' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('requires sign-in and the editors list for writes', async () => {
    const anon = await app.inject({ method: 'POST', url: '/api/topics', payload: topic });
    expect(anon.statusCode).toBe(401);
    const stranger = await app.inject({
      method: 'POST',
      url: '/api/topics',
      payload: topic,
      headers: { cookie: strangerCookie },
    });
    expect(stranger.statusCode).toBe(403);
  });

  it('lets an editor create, cite and relate topics', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/topics',
      payload: topic,
      headers: { cookie: editorCookie },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().topic).toMatchObject({ id: 'a-documented-case', updatedBy: 'john@example.com' });

    const cited = await app.inject({
      method: 'POST',
      url: '/api/topics/a-documented-case/references',
      payload: { label: 'NPR', url: 'https://www.npr.org/story' },
      headers: { cookie: editorCookie },
    });
    expect(cited.json().references).toHaveLength(1);

    const second = await app.inject({
      method: 'POST',
      url: '/api/topics',
      payload: { ...topic, title: 'A second case' },
      headers: { cookie: editorCookie },
    });
    const related = await app.inject({
      method: 'POST',
      url: '/api/relations',
      payload: { fromId: 'a-documented-case', toId: second.json().topic.id, kind: 'same-actor', note: 'Same agency.' },
      headers: { cookie: editorCookie },
    });
    expect(related.statusCode).toBe(201);
    const view = await app.inject({
      method: 'GET',
      url: '/api/topics/a-second-case?preview=1',
      headers: { cookie: editorCookie },
    });
    expect(view.json().related[0]).toMatchObject({ direction: 'incoming', other: { id: 'a-documented-case' } });
  });

  it('keeps drafts out of public reads until published', async () => {
    // New topics are drafts; the source added to a draft topic is a draft too.
    const anon = await app.inject({ method: 'GET', url: '/api/topics/a-documented-case' });
    expect(anon.statusCode).toBe(404);
    // ?preview=1 is ignored for anyone but an editor.
    const sneaky = await app.inject({ method: 'GET', url: '/api/topics/a-documented-case?preview=1', headers: { cookie: strangerCookie } });
    expect(sneaky.statusCode).toBe(404);

    const drafts = await app.inject({ method: 'GET', url: '/api/drafts', headers: { cookie: editorCookie } });
    expect(drafts.json().map((d: { type: string }) => d.type).sort()).toEqual(['reference', 'relation', 'topic', 'topic']);

    const published = await app.inject({
      method: 'POST',
      url: '/api/topics/a-documented-case/publish',
      payload: {},
      headers: { cookie: editorCookie },
    });
    expect(published.json().topic).toMatchObject({ status: 'published' });
    expect(published.json().references[0]).toMatchObject({ status: 'published' });
    // The link to the still-draft second case stays a draft.
    expect(published.json().related[0].relation).toMatchObject({ status: 'draft' });

    const live = await app.inject({ method: 'GET', url: '/api/topics/a-documented-case' });
    expect(live.statusCode).toBe(200);
    expect(live.json().related).toEqual([]);

    const unpublish = await app.inject({
      method: 'POST',
      url: '/api/status',
      payload: { status: 'draft', items: [{ type: 'topic', id: 'a-documented-case' }] },
      headers: { cookie: editorCookie },
    });
    expect(unpublish.json()).toEqual({ updated: 1 });
    expect((await app.inject({ method: 'GET', url: '/api/topics/a-documented-case' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/topics' })).json()).toEqual([]);
  });

  it('rejects unknown fields and bad values', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/topics/a-documented-case/references',
      payload: { label: 'X', url: 'javascript:alert(1)', admin: true },
      headers: { cookie: editorCookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('reports the session and editor flag', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: editorCookie } });
    expect(res.json()).toMatchObject({ editor: true, user: { email: 'john@example.com' } });
    const anon = await app.inject({ method: 'GET', url: '/api/session' });
    expect(anon.json()).toMatchObject({ user: null, editor: false });
  });

  it('serves editable pages: default until published, working copy only in preview', async () => {
    const pub = await app.inject({ method: 'GET', url: '/api/pages/about' });
    expect(pub.json()).toMatchObject({ id: 'about', title: 'About', state: 'default' });
    expect((await app.inject({ method: 'GET', url: '/api/pages/nope' })).statusCode).toBe(404);

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/pages/about',
      payload: { title: 'About GREED', body: 'New lead.\n\n## Section\n\n- one' },
      headers: { cookie: editorCookie },
    });
    expect(saved.json()).toMatchObject({ state: 'unpublished', title: 'About GREED' });
    // Readers still get the default, and so does a non-editor asking for preview.
    expect((await app.inject({ method: 'GET', url: '/api/pages/about' })).json().title).toBe('About');
    expect((await app.inject({ method: 'GET', url: '/api/pages/about?preview=1', headers: { cookie: strangerCookie } })).json().title).toBe('About');
    expect((await app.inject({ method: 'GET', url: '/api/pages/about?preview=1', headers: { cookie: editorCookie } })).json().title).toBe('About GREED');

    const published = await app.inject({ method: 'POST', url: '/api/pages/about/publish', headers: { cookie: editorCookie } });
    expect(published.json().state).toBe('published');
    expect((await app.inject({ method: 'GET', url: '/api/pages/about' })).json()).toMatchObject({ title: 'About GREED', state: 'published' });

    const anon = await app.inject({ method: 'PUT', url: '/api/pages/about', payload: { title: 'x', body: 'y' } });
    expect(anon.statusCode).toBe(401);
  });

  it('updates and deletes through the generated endpoints, children returning their topic', async () => {
    const as = { cookie: editorCookie };
    const created = await app.inject({ method: 'POST', url: '/api/topics', payload: { ...topic, title: 'Delete me' }, headers: as });
    const id = created.json().topic.id as string;
    const withPerspective = await app.inject({
      method: 'POST',
      url: `/api/topics/${id}/perspectives`,
      payload: { stance: 'critic', holder: 'ACLU', body: 'Unlawful.', refIds: [] },
      headers: as,
    });
    const pid = withPerspective.json().perspectives[0].id as string;
    const edited = await app.inject({
      method: 'PUT',
      url: `/api/topics/${id}/perspectives/${pid}`,
      payload: { stance: 'defender', holder: 'ACLU', body: 'Unlawful.', refIds: [] },
      headers: as,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().perspectives[0]).toMatchObject({ id: pid, stance: 'defender' });
    const missing = await app.inject({ method: 'PUT', url: `/api/topics/${id}/perspectives/nope`, payload: { stance: 'critic', holder: 'x', body: 'y', refIds: [] }, headers: as });
    expect(missing.statusCode).toBe(404);

    const removed = await app.inject({ method: 'DELETE', url: `/api/topics/${id}/perspectives/${pid}`, headers: as });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().perspectives).toEqual([]);

    const gone = await app.inject({ method: 'DELETE', url: `/api/topics/${id}`, headers: as });
    expect(gone.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/topics/${id}?preview=1`, headers: as })).statusCode).toBe(404);
  });

  it('lists the fixed-id pages for editors and refuses to create or delete them', async () => {
    const as = { cookie: editorCookie };
    const list = await app.inject({ method: 'GET', url: '/api/pages', headers: as });
    expect(list.json().map((p: { id: string }) => p.id)).toEqual(['home', 'about']);
    expect((await app.inject({ method: 'POST', url: '/api/pages', payload: { title: 'x', body: 'y' }, headers: as })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/pages/home', headers: as })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/pages' })).statusCode).toBe(401);
  });

  it('serves health, the graph, activity and the export', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url: '/api/graph' })).json()).toMatchObject({ nodes: expect.any(Array), edges: expect.any(Array) });
    expect((await app.inject({ method: 'GET', url: '/api/activity' })).json()).toEqual(expect.any(Array));
    const exported = await app.inject({ method: 'GET', url: '/api/export' });
    expect(exported.headers['content-disposition']).toMatch(/greed-export\.json/);
    expect(exported.json()).toMatchObject({ topics: [], exportedAt: expect.any(String) });
    expect((await app.inject({ method: 'GET', url: '/api/topics/nope' })).statusCode).toBe(404);
  });

  it('treats a bad or unknown session as signed out, and says which sign-in methods exist', async () => {
    const garbage = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: 'greed_session=garbage' } });
    expect(garbage.json()).toMatchObject({ user: null, editor: false, signIn: { local: true, github: false } });
    const auth = app.get(AuthService);
    const ghost = auth.issueSessionToken({ ...(await fakeUsers.findOrCreateByEmail('ghost@example.com')), providerAccountId: 'ghost-not-stored' });
    const unknown = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: `greed_session=${ghost}` } });
    expect(unknown.json()).toMatchObject({ user: null, editor: false });
  });

  it('signs in locally outside prod, defaulting to the local editor, and refuses in prod', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/local', payload: {} });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: 'editor@greed.local' });
    expect(String(res.headers['set-cookie'])).toMatch(/greed_session=/);
    const named = await app.inject({ method: 'POST', url: '/api/auth/local', payload: { email: 'john@example.com' } });
    expect(named.json()).toMatchObject({ email: 'john@example.com' });
    expect((await app.inject({ method: 'POST', url: '/api/auth/local', payload: { email: 'not-an-email' } })).statusCode).toBe(400);
    process.env.STAGE = 'prod';
    try {
      expect((await app.inject({ method: 'POST', url: '/api/auth/local', payload: {} })).statusCode).toBe(404);
    } finally {
      process.env.STAGE = 'test';
    }
  });
});
