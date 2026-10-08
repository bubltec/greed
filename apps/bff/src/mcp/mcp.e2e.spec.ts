import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AuthService, UsersService, type User } from '@bubltec/mycota-auth';
import { InMemoryContentStore } from '@greed/domain';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.js';
import { CONTENT_STORE } from '../content/content.tokens.js';
import { sha256 } from '../oauth/oauth.service.js';
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
    const toolList = (await rpc(token, 'tools/list')).json().result.tools as { name: string; inputSchema: any }[];
    expect(toolList.map((t) => t.name).sort()).toEqual(
      [
        'add_perspective', 'add_points', 'add_reference', 'create_outlet', 'create_topic', 'delete_draft', 'fetch_source', 'find_gaps', 'get_page', 'get_topic',
        'link_topics', 'list_document_providers', 'list_drafts', 'list_outlets', 'publish_page', 'publish_topic', 'read_document', 'research_topic', 'search_documents', 'search_topics', 'set_status', 'suggest_reference_urls', 'unlink_topics',
        'update_outlet', 'update_page', 'update_perspective', 'update_reference', 'update_topic',
      ].sort(),
    );
    // Schemas come from the DTOs: constraints and required fields included, with the hand-written descriptions.
    const schema = (name: string) => toolList.find((t) => t.name === name)!.inputSchema;
    expect(schema('create_topic').required).toEqual(['title', 'summary']);
    expect(schema('create_topic').properties.kind.enum).toContain('synthesis');
    expect(schema('create_topic').properties.title).toMatchObject({ minLength: 3, maxLength: 200, description: 'Specific, neutral title.' });
    expect(schema('create_topic').properties.sections.items.properties.points.items.properties.text.description).toBe('One factual point, plain text.');
    expect(schema('create_topic').properties.status).toBeUndefined();
    expect(schema('add_reference').required).toEqual(['topicId', 'label']);
    expect(schema('add_perspective').required).toEqual(['topicId', 'stance', 'holder', 'body']);
    expect(schema('update_perspective').required).toEqual(['topicId', 'perspectiveId']);
    expect(schema('link_topics').required).toEqual(['fromId', 'toId', 'kind', 'note']);
    expect(schema('update_page').properties.id.enum).toEqual(['home', 'about']);
    expect(schema('delete_draft').properties.type.enum).toEqual(['topic', 'reference', 'perspective', 'relation', 'outlet']);

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
    const withPerspective = await call(token, 'add_perspective', { topicId: a.id, stance: 'critic', holder: 'ACLU', body: 'Unlawful.' });
    const perspectiveId = withPerspective.perspectives.find((p: { holder: string }) => p.holder === 'ACLU').id;
    // Partial update: only the stance changes; holder and body are kept.
    await call(token, 'update_perspective', { topicId: a.id, perspectiveId, stance: 'defender' });
    const link = await call(token, 'link_topics', { fromId: a.id, toId: b.id, kind: 'shared-mechanism', note: 'Both favour fossil fuel incumbents.' });
    expect(link).toMatchObject({ provenance: 'inferred', updatedBy: 'john@example.com (mcp)' });

    const full = await call(token, 'get_topic', { id: a.id });
    expect(full.topic.sections[0].points[0].refIds).toEqual([refId]);
    expect(full.perspectives).toHaveLength(2);
    expect(full.perspectives.find((p: { id: string }) => p.id === perspectiveId)).toMatchObject({ stance: 'defender', holder: 'ACLU', body: 'Unlawful.', status: 'draft' });
    expect(full.related[0].other.id).toBe(b.id);

    // Everything the connector wrote is a draft: invisible publicly until published.
    expect((await app.inject({ method: 'GET', url: `/api/topics/${a.id}` })).statusCode).toBe(404);
    const queue = await call(token, 'list_drafts', {});
    expect(queue.drafts.length).toBe(6); // 2 topics, 1 reference, 2 perspectives, 1 link
    const published = await call(token, 'publish_topic', { topicId: a.id });
    expect(published.status).toBe('published');
    expect(published.references[0].status).toBe('published');
    // The link points at a topic that is still a draft, so it waits.
    expect(published.related[0].status).toBe('draft');
    const pub = await app.inject({ method: 'GET', url: `/api/topics/${a.id}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().related).toEqual([]);

    // Pages: Claude edits the working copy; the live page waits for publish_page.
    await call(token, 'update_page', { id: 'home', title: 'Follow the money.', body: 'Sourced and cross-linked.' });
    expect((await app.inject({ method: 'GET', url: '/api/pages/home' })).json().state).toBe('default');
    expect((await call(token, 'publish_page', { id: 'home' })).state).toBe('published');
    expect((await app.inject({ method: 'GET', url: '/api/pages/home' })).json().title).toBe('Follow the money.');

    const found = await call(token, 'search_topics', { query: 'epa oil' });
    expect(found.total).toBe(1);
    const gaps = await call(token, 'find_gaps', {});
    expect(gaps.topicsWithoutSources.map((t: { id: string }) => t.id)).toEqual([b.id]);

    // delete_draft discards drafts only; the published topic is refused.
    const refused = await rpc(token, 'tools/call', { name: 'delete_draft', arguments: { type: 'topic', id: a.id } });
    expect(refused.json().result).toMatchObject({ isError: true });
    expect(await call(token, 'delete_draft', { type: 'topic', id: b.id })).toEqual({ deleted: b.id, type: 'topic' });
    expect((await call(token, 'search_topics', { query: 'coal' })).total).toBe(0);
  });

  it('ranks outlets and will not search until one is published', async () => {
    const { access_token: token } = await getTokens();
    const outlet = {
      paywall: false,
      accuracy: 'high',
      bias: 'low',
      oneSided: false,
      factual: 'high',
    };
    await call(token, 'create_outlet', { ...outlet, name: 'CNN', domain: 'cnn.com', paywall: true, accuracy: 'mixed' });
    await call(token, 'create_outlet', { ...outlet, name: 'NPR', domain: 'npr.org' });
    const listed = await call(token, 'list_outlets', {});
    expect(listed.outlets.map((o: { name: string; hardAvoid: boolean }) => [o.name, o.hardAvoid])).toEqual([
      ['NPR', false],
      ['CNN', true],
    ]);
    const gateway = process.env.AGENTCORE_GATEWAY_URL;
    const memory = process.env.AGENTCORE_MEMORY_ID;
    delete process.env.AGENTCORE_GATEWAY_URL;
    delete process.env.AGENTCORE_MEMORY_ID;
    try {
      const topic = await call(token, 'create_topic', { title: 'A recorded case', summary: 'Something documented.' });
      const dive = await call(token, 'research_topic', { topicId: topic.id });
      expect(dive.configured).toBe(false);
      expect(dive.hits).toEqual([]);
      expect(dive.skippedPaywalls.map((o: { domain: string }) => o.domain)).toEqual(['cnn.com']);
    } finally {
      if (gateway) process.env.AGENTCORE_GATEWAY_URL = gateway;
      if (memory) process.env.AGENTCORE_MEMORY_ID = memory;
    }
  });

  it('rejects a research date that is not YYYY-MM-DD', async () => {
    const { access_token: token } = await getTokens();
    const res = await rpc(token, 'tools/call', { name: 'research_topic', arguments: { topicId: 'x', from: 'Oct 5' } });
    expect(res.json().result).toMatchObject({ isError: true });
    expect(res.json().result.content[0].text).toMatch(/YYYY-MM-DD/);
    const bad = await rpc(token, 'tools/call', { name: 'research_topic', arguments: { topicId: 'x', query: 5 } });
    expect(bad.json().result.content[0].text).toMatch(/query must be a string/);
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

const form = { 'content-type': 'application/x-www-form-urlencoded' };
const post = (url: string, payload: Record<string, string> | string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, headers: { ...form, ...headers }, payload: typeof payload === 'string' ? payload : new URLSearchParams(payload).toString() });
const store = () => app.get<InMemoryOAuthStore>(OAUTH_STORE);
const tokenRequest = (extra: Record<string, string>) => post('/api/oauth/token', { client_id: clientId, ...extra });

async function authorizeCode(decision = 'allow', extra: Record<string, string> = {}) {
  const q = authorizeQuery();
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const res = await post('/api/oauth/authorize', `${q}&decision=${decision}`, { cookie: editorCookie });
  return new URL(res.headers.location as string);
}

describe('OAuth endpoints', () => {
  it('rejects bad client registrations', async () => {
    const register = (payload: Record<string, unknown> | undefined) => app.inject({ method: 'POST', url: '/api/oauth/register', payload });
    for (const redirect_uris of [undefined, [], ['http://example.com/cb'], ['not a url'], ['https://x.example/cb#frag'], [7], Array(11).fill('https://x.example/cb')]) {
      const res = await register({ redirect_uris });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_redirect_uri');
    }
    expect((await register(undefined)).statusCode).toBe(400);
    const confidential = await register({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' });
    expect(confidential.json().error).toBe('invalid_client_metadata');
  });

  it('names unnamed clients and truncates long names; accepts loopback http', async () => {
    const anon = await app.inject({ method: 'POST', url: '/api/oauth/register', payload: { redirect_uris: ['http://localhost:8080/cb'] } });
    expect(anon.json().client_name).toBe('Unnamed client');
    const long = await app.inject({ method: 'POST', url: '/api/oauth/register', payload: { client_name: 'x'.repeat(300), redirect_uris: ['http://127.0.0.1:1/cb'] } });
    expect(long.json().client_name).toHaveLength(100);
  });

  it('explains authorize problems on an error page rather than redirecting', async () => {
    const get = (mutate: (q: URLSearchParams) => void) => {
      const q = authorizeQuery();
      mutate(q);
      return app.inject({ method: 'GET', url: `/api/oauth/authorize?${q}`, headers: { cookie: editorCookie } });
    };
    expect((await get((q) => q.set('client_id', 'unknown'))).body).toContain('Unknown client');
    expect((await get((q) => q.delete('client_id'))).statusCode).toBe(400);
    expect((await get((q) => q.set('response_type', 'token'))).body).toContain('response_type');
    expect((await get((q) => q.delete('code_challenge'))).body).toContain('PKCE');
    expect((await get((q) => q.set('code_challenge_method', 'plain'))).body).toContain('PKCE');
    // The only registered redirect URI is used when the request omits one.
    const implied = await get((q) => q.delete('redirect_uri'));
    expect(implied.statusCode).toBe(200);
    expect(implied.body).toContain('claude.ai');
  });

  it('returns the state and a denial when the editor says no, and a code with the issuer when yes', async () => {
    const denied = await authorizeCode('deny');
    expect(denied.searchParams.get('error')).toBe('access_denied');
    expect(denied.searchParams.get('state')).toBe('st4te');
    expect(denied.searchParams.get('code')).toBeNull();
    const q = authorizeQuery();
    q.delete('state');
    const res = await post('/api/oauth/authorize', `${q}&decision=allow`, { cookie: editorCookie });
    const allowed = new URL(res.headers.location as string);
    expect(allowed.searchParams.get('state')).toBeNull();
    expect(allowed.searchParams.get('iss')).toBe(ORIGIN);
    expect(allowed.searchParams.get('code')).toBeTruthy();
  });

  it('refuses the consent post from anyone who is not a signed-in editor, or with bad parameters', async () => {
    for (const headers of [{}, { cookie: strangerCookie }, { cookie: 'greed_session=garbage' }] as Record<string, string>[]) {
      expect((await post('/api/oauth/authorize', `${authorizeQuery()}&decision=allow`, headers)).statusCode).toBe(403);
    }
    const bad = authorizeQuery();
    bad.set('client_id', 'unknown');
    expect((await post('/api/oauth/authorize', `${bad}&decision=allow`, { cookie: editorCookie })).statusCode).toBe(400);
  });

  it('signs in as the local editor and resumes the authorize page, never an arbitrary path', async () => {
    const resume = `/api/oauth/authorize?${authorizeQuery()}`;
    const back = await app.inject({ method: 'POST', url: '/api/oauth/local-sign-in', headers: { cookie: `greed_oauth_return=${encodeURIComponent(resume)}` } });
    expect(back.statusCode).toBe(302);
    expect(back.headers.location).toBe(resume);
    expect(String(back.headers['set-cookie'])).toContain('greed_session=');
    const elsewhere = await app.inject({ method: 'POST', url: '/api/oauth/local-sign-in', headers: { cookie: 'greed_oauth_return=%2Fsomewhere-else' } });
    expect(elsewhere.headers.location).toBe('/admin');
    expect((await app.inject({ method: 'POST', url: '/api/oauth/local-sign-in' })).headers.location).toBe('/admin');
    process.env.STAGE = 'prod';
    try {
      expect((await app.inject({ method: 'POST', url: '/api/oauth/local-sign-in' })).statusCode).toBe(404);
      // In prod the sign-in page offers no local sign-in, and with GitHub unconfigured nothing at all.
      const out = await app.inject({ method: 'GET', url: `/api/oauth/authorize?${authorizeQuery()}` });
      expect(out.body).toContain('No sign-in method is configured');
    } finally {
      process.env.STAGE = 'test';
    }
  });

  it('exchanges codes only with the right verifier, client, redirect URI, and once', async () => {
    const codeOf = async () => (await authorizeCode()).searchParams.get('code')!;
    const base = { grant_type: 'authorization_code', redirect_uri: REDIRECT, code_verifier: VERIFIER };
    expect((await tokenRequest({ ...base, code: await codeOf() })).statusCode).toBe(200);
    const spent = await codeOf();
    await tokenRequest({ ...base, code: spent });
    expect((await tokenRequest({ ...base, code: spent })).json().error).toBe('invalid_grant'); // replay
    expect((await tokenRequest({ ...base, code: await codeOf(), code_verifier: `${VERIFIER}x` })).json().error).toBe('invalid_grant');
    expect((await tokenRequest({ ...base, code: await codeOf(), redirect_uri: 'https://claude.ai/other' })).json().error).toBe('invalid_grant');
    expect((await tokenRequest({ grant_type: 'authorization_code', code_verifier: VERIFIER })).json().error).toBe('invalid_request'); // no code
    expect((await tokenRequest({ grant_type: 'authorization_code', code: 'c' })).json().error).toBe('invalid_request'); // no verifier
    const noRedirect = await tokenRequest({ grant_type: 'authorization_code', code: await codeOf(), code_verifier: VERIFIER });
    expect(noRedirect.statusCode).toBe(200); // redirect_uri may be omitted
    store().codes.set(sha256('expired'), { codeHash: sha256('expired'), clientId, userKey: 'email:john@example.com', redirectUri: REDIRECT, codeChallenge: CHALLENGE, scope: 'greed', expiresAt: 1 });
    expect((await tokenRequest({ ...base, code: 'expired' })).json().error).toBe('invalid_grant');
    expect((await post('/api/oauth/token', { client_id: 'nobody', ...base, code: 'x' })).statusCode).toBe(401);
    expect((await post('/api/oauth/token', { ...base, code: 'x' })).statusCode).toBe(401);
    expect((await tokenRequest({ grant_type: 'password' })).json().error).toBe('unsupported_grant_type');
  });

  it('rotates refresh tokens and rejects reuse, access tokens and other clients’ tokens', async () => {
    const first = await getTokens();
    const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.headers['cache-control']).toBe('no-store');
    expect(refreshed.json().refresh_token).not.toBe(first.refresh_token);
    expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token })).json().error).toBe('invalid_grant');
    expect((await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshed.json().access_token })).json().error).toBe('invalid_grant');
    expect((await tokenRequest({ grant_type: 'refresh_token' })).json().error).toBe('invalid_grant');
    const other = await app.inject({ method: 'POST', url: '/api/oauth/register', payload: { redirect_uris: [REDIRECT] } });
    const stolen = await post('/api/oauth/token', { client_id: other.json().client_id, grant_type: 'refresh_token', refresh_token: refreshed.json().refresh_token });
    expect(stolen.json().error).toBe('invalid_grant');
  });
});

describe('MCP protocol', () => {
  const raw = (token: string, payload: unknown) =>
    app.inject({ method: 'POST', url: '/api/mcp', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload: payload as object });

  it('answers initialize with a supported protocol version, falling back to the newest', async () => {
    const { access_token: token } = await getTokens();
    expect((await rpc(token, 'initialize', { protocolVersion: '2025-03-26' })).json().result.protocolVersion).toBe('2025-03-26');
    expect((await rpc(token, 'initialize', { protocolVersion: '1999-01-01' })).json().result.protocolVersion).toBe('2025-11-25');
    expect((await rpc(token, 'initialize')).json().result.protocolVersion).toBe('2025-11-25');
    expect((await rpc(token, 'ping')).json().result).toEqual({});
  });

  it('handles notifications, batches and junk messages', async () => {
    const { access_token: token } = await getTokens();
    expect((await raw(token, { jsonrpc: '2.0', method: 'notifications/initialized' })).statusCode).toBe(202);
    expect((await raw(token, { jsonrpc: '2.0', id: null, method: 'ping' })).statusCode).toBe(202);
    const batch = await raw(token, [{ jsonrpc: '2.0', id: 1, method: 'ping' }, null, 'junk', { jsonrpc: '2.0', method: 'notifications/x' }, { jsonrpc: '2.0', id: 2, method: 'ping' }]);
    expect(batch.json()).toEqual([
      { jsonrpc: '2.0', id: 1, result: {} },
      { jsonrpc: '2.0', id: 2, result: {} },
    ]);
  });

  it('reports protocol errors as JSON-RPC errors and tool failures as tool errors', async () => {
    const { access_token: token } = await getTokens();
    expect((await rpc(token, 'nope/nothing')).json().error).toMatchObject({ code: -32601, message: expect.stringContaining('nope/nothing') });
    expect((await rpc(token, 'tools/call', {})).json().error).toMatchObject({ code: -32603, message: expect.stringContaining('name') });
    const unknown = await rpc(token, 'tools/call', { name: 'no_such_tool' });
    expect(unknown.json().result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('Unknown tool') }] });
    const missing = await rpc(token, 'tools/call', { name: 'get_topic', arguments: {} });
    expect(missing.json().result.content[0].text).toContain('id is required');
    const notFound = await rpc(token, 'tools/call', { name: 'get_topic', arguments: { id: 'nope' } });
    expect(notFound.json().result.content[0].text).toContain('No topic');
  });

  it('runs a tool called without an arguments object', async () => {
    const { access_token: token } = await getTokens();
    const drafts = await rpc(token, 'tools/call', { name: 'list_drafts' });
    expect(drafts.json().result.structuredContent).toHaveProperty('drafts');
  });

  it('only accepts POST, and only live access tokens of current editors', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/mcp' })).statusCode).toBe(405);
    expect((await app.inject({ method: 'DELETE', url: '/api/mcp' })).headers.allow).toBe('POST');
    const mint = async (raw: string, userKey: string, expiresAt = Math.floor(Date.now() / 1000) + 600, kind: 'access' | 'refresh' = 'access') =>
      store().putToken({ tokenHash: sha256(raw), kind, clientId, userKey, scope: 'greed', expiresAt, createdAt: new Date().toISOString() });
    await mint('stranger', 'email:someone@example.com');
    await mint('ghost', 'email:nobody@example.com');
    await mint('expired', 'email:john@example.com', 1);
    await mint('refresh-as-access', 'email:john@example.com', undefined, 'refresh');
    await mint('good', 'email:john@example.com');
    for (const token of ['stranger', 'ghost', 'expired', 'refresh-as-access', 'garbage']) {
      expect((await rpc(token, 'ping')).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/api/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'ping' } })).statusCode).toBe(401); // no header
    expect((await rpc('good', 'ping')).statusCode).toBe(200);
    // Recorded under the account's email, as "(mcp)".
    expect((await call('good', 'create_topic', { title: 'Who did it', summary: 's' })).id).toBe('who-did-it');
  });
});
