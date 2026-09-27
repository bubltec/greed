import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isAllowedRedirectUri, OAuthService } from './oauth.service.js';
import { InMemoryOAuthStore } from './oauth.store.js';

const pkce = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const VERIFIER = 'a-long-random-verifier-string-that-is-at-least-43-chars-long';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

async function setup() {
  const store = new InMemoryOAuthStore();
  const svc = new OAuthService(store);
  const client = await svc.register({ client_name: 'Claude', redirect_uris: [REDIRECT] });
  const authorize = (overrides: Record<string, unknown> = {}) =>
    svc.validateAuthorize({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      code_challenge: pkce(VERIFIER),
      code_challenge_method: 'S256',
      state: 'xyz',
      ...overrides,
    });
  return { store, svc, client, authorize };
}

describe('OAuthService', () => {
  it('registers public clients with safe redirect URIs only', async () => {
    const { svc } = await setup();
    await expect(svc.register({ redirect_uris: ['http://evil.example/cb'] })).rejects.toThrow(/redirect_uris/);
    await expect(svc.register({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' })).rejects.toThrow(/public/);
    expect(isAllowedRedirectUri('http://localhost:33418/callback')).toBe(true);
    expect(isAllowedRedirectUri('https://x.example/cb#frag')).toBe(false);
  });

  it('rejects unknown clients, unregistered redirects and missing PKCE', async () => {
    const { authorize } = await setup();
    await expect(authorize({ client_id: 'nope' })).rejects.toThrow(/Unknown client/);
    await expect(authorize({ redirect_uri: 'https://attacker.example/cb' })).rejects.toThrow(/redirect_uri/);
    await expect(authorize({ code_challenge_method: 'plain' })).rejects.toThrow(/PKCE/);
  });

  it('exchanges a code once, with the right verifier, then rotates refresh tokens', async () => {
    const { svc, client, authorize } = await setup();
    const code = await svc.issueCode(await authorize(), 'github:42');
    const exchange = (verifier: string) =>
      svc.token({ grant_type: 'authorization_code', client_id: client.client_id, code, code_verifier: verifier, redirect_uri: REDIRECT });

    await expect(exchange('wrong-verifier')).rejects.toThrow(/invalid/);
    // The failed attempt consumed the code: codes are single-use even on failure.
    await expect(exchange(VERIFIER)).rejects.toThrow(/invalid/);

    const code2 = await svc.issueCode(await authorize(), 'github:42');
    const tokens = await svc.token({ grant_type: 'authorization_code', client_id: client.client_id, code: code2, code_verifier: VERIFIER });
    expect(tokens).toMatchObject({ token_type: 'Bearer', scope: 'greed' });
    expect((await svc.authenticate(`Bearer ${tokens.access_token}`))?.userKey).toBe('github:42');
    expect(await svc.authenticate(`Bearer ${tokens.refresh_token}`)).toBeUndefined();

    const refreshed = await svc.token({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token });
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    await expect(
      svc.token({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token }),
    ).rejects.toThrow(/Refresh token/);
  });

  it('never stores raw codes or tokens', async () => {
    const { svc, store, client, authorize } = await setup();
    const code = await svc.issueCode(await authorize(), 'github:42');
    expect([...store.codes.keys()]).not.toContain(code);
    const tokens = await svc.token({ grant_type: 'authorization_code', client_id: client.client_id, code, code_verifier: VERIFIER });
    const stored = JSON.stringify([...store.tokens.values()]);
    expect(stored).not.toContain(tokens.access_token);
    expect(stored).not.toContain(tokens.refresh_token);
  });
});
