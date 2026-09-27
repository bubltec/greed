import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { OAUTH_STORE, type OAuthClient, type OAuthStore, type TokenRecord } from './oauth.store.js';

export const SCOPE = 'greed';
const CODE_TTL_S = 10 * 60;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 60 * 60 * 24 * 30;

/** RFC 6749 §5.2 error, rendered as `{ error, error_description }`. */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface AuthorizeRequest {
  client: OAuthClient;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scope: string;
}

const now = () => Math.floor(Date.now() / 1000);
const secret = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');

/** Redirect URIs must be https, or http on loopback (native and CLI clients). */
export function isAllowedRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * A small OAuth 2.1 authorization server for the MCP connector: dynamic client
 * registration (RFC 7591), authorization code + PKCE S256 only, public clients
 * only, opaque tokens stored hashed, refresh tokens rotated on every use.
 * Identity comes from the editor's existing mycota-auth session; this never
 * handles passwords.
 */
@Injectable()
export class OAuthService {
  constructor(@Inject(OAUTH_STORE) private readonly store: OAuthStore) {}

  async register(body: Record<string, unknown>) {
    const redirectUris = body.redirect_uris;
    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      redirectUris.length > 10 ||
      !redirectUris.every((u) => typeof u === 'string' && isAllowedRedirectUri(u))
    ) {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be https (or http on localhost) URLs');
    }
    const method = body.token_endpoint_auth_method;
    if (method !== undefined && method !== 'none') {
      throw new OAuthError('invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none") are supported');
    }
    const rawName = typeof body.client_name === 'string' ? body.client_name.trim() : '';
    const client: OAuthClient = {
      clientId: randomUUID(),
      clientName: rawName.slice(0, 100) || 'Unnamed client',
      redirectUris: redirectUris as string[],
      createdAt: new Date().toISOString(),
    };
    await this.store.putClient(client);
    return {
      client_id: client.clientId,
      client_id_issued_at: now(),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPE,
    };
  }

  /**
   * Checks an authorization request. Client and redirect URI problems throw
   * (the caller must show an error page, never redirect to an unverified URI).
   */
  async validateAuthorize(q: Record<string, unknown>): Promise<AuthorizeRequest> {
    const clientId = str(q.client_id);
    const client = clientId ? await this.store.getClient(clientId) : undefined;
    if (!client) throw new OAuthError('invalid_client', 'Unknown client. Remove and re-add the connector.');
    const redirectUri = str(q.redirect_uri) ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      throw new OAuthError('invalid_request', 'redirect_uri does not match the registered client');
    }
    if (q.response_type !== 'code') throw new OAuthError('unsupported_response_type', 'response_type must be "code"');
    const codeChallenge = str(q.code_challenge);
    if (!codeChallenge || q.code_challenge_method !== 'S256') {
      throw new OAuthError('invalid_request', 'PKCE with code_challenge_method S256 is required');
    }
    return { client, redirectUri, codeChallenge, state: str(q.state), scope: SCOPE };
  }

  async issueCode(req: AuthorizeRequest, userKey: string): Promise<string> {
    const code = secret();
    await this.store.putCode({
      codeHash: sha256(code),
      clientId: req.client.clientId,
      userKey,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      scope: req.scope,
      expiresAt: now() + CODE_TTL_S,
    });
    return code;
  }

  async token(body: Record<string, unknown>): Promise<TokenResponse> {
    const clientId = str(body.client_id);
    if (!clientId || !(await this.store.getClient(clientId))) {
      throw new OAuthError('invalid_client', 'Unknown client', 401);
    }
    if (body.grant_type === 'authorization_code') {
      const code = str(body.code);
      const verifier = str(body.code_verifier);
      if (!code || !verifier) throw new OAuthError('invalid_request', 'code and code_verifier are required');
      const record = await this.store.takeCode(sha256(code));
      if (
        !record ||
        record.expiresAt < now() ||
        record.clientId !== clientId ||
        (str(body.redirect_uri) ?? record.redirectUri) !== record.redirectUri ||
        sha256(verifier) !== record.codeChallenge
      ) {
        throw new OAuthError('invalid_grant', 'Authorization code is invalid, expired, or already used');
      }
      return this.issueTokens(clientId, record.userKey, record.scope);
    }
    if (body.grant_type === 'refresh_token') {
      const refresh = str(body.refresh_token);
      const record = refresh ? await this.store.takeToken(sha256(refresh)) : undefined;
      if (!record || record.kind !== 'refresh' || record.expiresAt < now() || record.clientId !== clientId) {
        throw new OAuthError('invalid_grant', 'Refresh token is invalid or expired');
      }
      return this.issueTokens(clientId, record.userKey, record.scope);
    }
    throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
  }

  private async issueTokens(clientId: string, userKey: string, scope: string): Promise<TokenResponse> {
    const access = secret();
    const refresh = secret();
    const base = { clientId, userKey, scope, createdAt: new Date().toISOString() };
    await this.store.putToken({ ...base, tokenHash: sha256(access), kind: 'access', expiresAt: now() + ACCESS_TTL_S });
    await this.store.putToken({ ...base, tokenHash: sha256(refresh), kind: 'refresh', expiresAt: now() + REFRESH_TTL_S });
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
  }

  /** The access token's record, if it is a live access token. */
  async authenticate(authorization: string | undefined): Promise<TokenRecord | undefined> {
    const match = authorization?.match(/^Bearer\s+(\S+)$/i);
    if (!match) return undefined;
    const record = await this.store.getToken(sha256(match[1]!));
    if (!record || record.kind !== 'access' || record.expiresAt < now()) return undefined;
    return record;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
