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
    const view = await app.inject({ method: 'GET', url: '/api/topics/a-second-case?fresh=1' });
    expect(view.json().related[0]).toMatchObject({ direction: 'incoming', other: { id: 'a-documented-case' } });
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
});
