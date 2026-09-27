import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AuthService, UsersService, type User } from '@bubltec/mycota-auth';
import { InMemoryContentStore } from '@greed/domain';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.js';
import { CONTENT_STORE } from '../content/content.tokens.js';
import { InMemoryOAuthStore, OAUTH_STORE } from '../oauth/oauth.store.js';

/**
 * The whole connector flow as Claude runs it: discovery, dynamic registration,
 * editor consent, PKCE code exchange, then MCP calls with the bearer token.
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

const ORIGIN = 'https://greed.example';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'verifier-verifier-verifier-verifier-verifier-verifier';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

let app: NestFastifyApplication;
let editorCookie: string;
let strangerCookie: string;
let clientId: string;

beforeAll(async () => {
  process.env.STAGE = 'test';
  process.env.EDITORS = 'john@example.com';
  process.env.WEB_ORIGIN = ORIGIN;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CONTENT_STORE)
    .useValue(new InMemoryContentStore())
    .overrideProvider(OAUTH_STORE)
    .useValue(new InMemoryOAuthStore())
    .overrideProvider(UsersService)
    .useValue(fakeUsers)
    .compile();
  app = await configureApp(moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter()));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const auth = app.get(AuthService);
  editorCookie = `greed_session=${auth.issueSessionToken(await fakeUsers.findOrCreateByEmail('john@example.com'))}`;
  strangerCookie = `greed_session=${auth.issueSessionToken(await fakeUsers.findOrCreateByEmail('someone@example.com'))}`;
});

afterAll(async () => {
  await app?.close();
});

const authorizeQuery = () =>
  new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'st4te',
    resource: `${ORIGIN}/api/mcp`,
  });

async function getTokens() {
  const consent = await app.inject({
    method: 'POST',
    url: '/api/oauth/authorize',
    headers: { cookie: editorCookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: `${authorizeQuery()}&decision=allow`,
  });
  expect(consent.statusCode).toBe(302);
  const location = new URL(consent.headers.location as string);
  expect(location.origin + location.pathname).toBe(REDIRECT);
  expect(location.searchParams.get('state')).toBe('st4te');
  const token = await app.inject({
    method: 'POST',
    url: '/api/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code: location.searchParams.get('code')!,
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT,
    }).toString(),
  });
  expect(token.statusCode).toBe(200);
  return token.json() as { access_token: string; refresh_token: string };
}

let rpcId = 0;
async function rpc(token: string, method: string, params: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/mcp',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    payload: { jsonrpc: '2.0', id: ++rpcId, method, params },
  });
  return res;
}
async function call(token: string, name: string, args: Record<string, unknown>) {
  const res = await rpc(token, 'tools/call', { name, arguments: args });
  const result = res.json().result as { isError?: boolean; structuredContent: Record<string, unknown>; content: { text: string }[] };
  if (result.isError) throw new Error(result.content[0]!.text);
  return result.structuredContent as Record<string, any>;
}

describe('MCP connector', () => {
  it('publishes discovery documents at the site root', async () => {
    const prm = await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/api/mcp' });
    expect(prm.json()).toMatchObject({ resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN] });
    const as = await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' });
    expect(as.json()).toMatchObject({
      issuer: ORIGIN,
      registration_endpoint: `${ORIGIN}/api/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('answers unauthenticated MCP calls with a pointer to the metadata', async () => {
    const res = await rpc('nope', 'initialize');
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`);
  });

  it('registers a client dynamically', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/register',
      payload: { client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' },
    });
    expect(res.statusCode).toBe(201);
    clientId = res.json().client_id;
  });

  it('asks signed-out users to sign in, refuses non-editors, and shows editors a consent page', async () => {
    const out = await app.inject({ method: 'GET', url: `/api/oauth/authorize?${authorizeQuery()}` });
    expect(out.body).toContain('Sign in to connect Claude');
    expect(String(out.headers['set-cookie'])).toContain('greed_oauth_return=');

    const stranger = await app.inject({ method: 'GET', url: `/api/oauth/authorize?${authorizeQuery()}`, headers: { cookie: strangerCookie } });
    expect(stranger.statusCode).toBe(403);

    const editor = await app.inject({ method: 'GET', url: `/api/oauth/authorize?${authorizeQuery()}`, headers: { cookie: editorCookie } });
    expect(editor.statusCode).toBe(200);
    expect(editor.body).toContain('Connect Claude?');
    expect(editor.body).toContain('john@example.com');
  });

  it('never redirects to an unregistered URI', async () => {
    const q = authorizeQuery();
    q.set('redirect_uri', 'https://attacker.example/cb');
    const res = await app.inject({
      method: 'POST',
      url: '/api/oauth/authorize',
      headers: { cookie: editorCookie, 'content-type': 'application/x-www-form-urlencoded' },
      payload: `${q}&decision=allow`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('lets an editor research and file a topic end to end', async () => {
    const { access_token: token } = await getTokens();

    const init = await rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(init.json().result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'greed' } });
    const tools = (await rpc(token, 'tools/list')).json().result.tools.map((t: { name: string }) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['search_topics', 'create_topic', 'add_reference', 'add_points', 'link_topics']));

    const a = await call(token, 'create_topic', { title: 'Oil money and the EPA', summary: 'Donations preceded rollbacks.' });
    const b = await call(token, 'create_topic', { title: 'Coal plant emergency orders', summary: 'DOE kept plants open.' });
    const withRef = await call(token, 'add_reference', { topicId: a.id, label: 'NPR', url: 'https://www.npr.org/x', publishedOn: '2026-09' });
    const refId = withRef.added.id;
    const updated = await call(token, 'add_points', {
      topicId: a.id,
      sectionLabel: 'What happened',
      points: [{ text: 'Industry gave $X before the rule changed.', refIds: [refId] }],
    });
    expect(updated.sections).toEqual([{ label: 'What happened', points: 1 }]);
    await call(token, 'add_perspective', { topicId: a.id, stance: 'official', holder: 'EPA', body: 'Rules were updated on the merits.', refIds: [refId] });
    const link = await call(token, 'link_topics', { fromId: a.id, toId: b.id, kind: 'shared-mechanism', note: 'Both favour fossil fuel incumbents.' });
    expect(link).toMatchObject({ provenance: 'inferred', updatedBy: 'john@example.com (mcp)' });

    const full = await call(token, 'get_topic', { id: a.id });
    expect(full.topic.sections[0].points[0].refIds).toEqual([refId]);
    expect(full.perspectives).toHaveLength(1);
    expect(full.related[0].other.id).toBe(b.id);

    const found = await call(token, 'search_topics', { query: 'epa oil' });
    expect(found.total).toBe(1);
    const gaps = await call(token, 'find_gaps', {});
    expect(gaps.topicsWithoutSources.map((t: { id: string }) => t.id)).toEqual([b.id]);
  });

  it('returns validation failures to the model as tool errors', async () => {
    const { access_token: token } = await getTokens();
    const res = await rpc(token, 'tools/call', { name: 'add_reference', arguments: { topicId: 'oil-money-and-the-epa', label: 'X', url: 'javascript:alert(1)' } });
    expect(res.json().result).toMatchObject({ isError: true });
    expect(res.json().result.content[0].text).toMatch(/url/);
  });

  it('stops working when the account leaves the editors list', async () => {
    const { access_token: token } = await getTokens();
    process.env.EDITORS = 'someone-else@example.com';
    expect((await rpc(token, 'tools/list')).statusCode).toBe(401);
    process.env.EDITORS = 'john@example.com';
  });
});
