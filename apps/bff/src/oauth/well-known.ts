import type { FastifyInstance } from 'fastify';
import { publicOrigin } from '../env.js';
import { SCOPE } from './oauth.service.js';

export const RETURN_COOKIE = 'greed_oauth_return';
export const MCP_PATH = '/api/mcp';

export function protectedResourceMetadata() {
  const origin = publicOrigin();
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'GREED',
  };
}

export function authorizationServerMetadata() {
  const origin = publicOrigin();
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
  };
}

/**
 * Discovery documents live at the site root (RFC 8414 / RFC 9728), outside
 * Nest's /api prefix, so they're plain Fastify routes. CloudFront routes
 * /.well-known/* to the API for the same reason.
 */
export function registerWellKnown(fastify: FastifyInstance) {
  const json = (body: () => unknown) => async (_req: unknown, reply: { header: (k: string, v: string) => { send: (b: unknown) => unknown } }) =>
    reply.header('cache-control', 'max-age=300').send(body());
  for (const path of ['/.well-known/oauth-protected-resource', `/.well-known/oauth-protected-resource${MCP_PATH}`]) {
    fastify.get(path, json(protectedResourceMetadata));
  }
  for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
    fastify.get(path, json(authorizationServerMetadata));
  }
}

/**
 * mycota-auth's GitHub callback always lands on the web origin. When the
 * sign-in started on the OAuth authorize page, send the browser back there
 * instead, so connecting Claude is one uninterrupted flow.
 */
export function registerOAuthReturnHook(fastify: FastifyInstance) {
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (!request.url.startsWith('/api/auth/github/callback') || reply.statusCode !== 302) return payload;
    const back = request.cookies?.[RETURN_COOKIE];
    if (back?.startsWith('/api/oauth/authorize')) {
      reply.header('location', back);
      reply.clearCookie(RETURN_COOKIE, { path: '/api' });
    }
    return payload;
  });
}
