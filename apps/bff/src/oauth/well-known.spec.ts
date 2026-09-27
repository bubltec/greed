import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { describe, expect, it } from 'vitest';
import { registerOAuthReturnHook } from './well-known.js';

describe('registerOAuthReturnHook', () => {
  async function server() {
    const fastify = Fastify();
    registerOAuthReturnHook(fastify);
    await fastify.register(fastifyCookie);
    // Stand-in for mycota-auth's GitHub callback, which always goes to the web origin.
    fastify.get('/api/auth/github/callback', (_req, reply) => {
      reply.setCookie('greed_session', 'jwt', { path: '/' });
      return reply.redirect('https://greed.example/?signedIn=1', 302);
    });
    return fastify;
  }

  it('resumes the OAuth authorize page after GitHub sign-in', async () => {
    const res = await (await server()).inject({
      url: '/api/auth/github/callback?code=x',
      cookies: { greed_oauth_return: '/api/oauth/authorize?client_id=c' },
    });
    expect(res.headers.location).toBe('/api/oauth/authorize?client_id=c');
    const cookies = String(res.headers['set-cookie']);
    expect(cookies).toContain('greed_session=jwt');
    expect(cookies).toMatch(/greed_oauth_return=;/);
  });

  it('leaves normal sign-ins and foreign return paths alone', async () => {
    const app = await server();
    expect((await app.inject({ url: '/api/auth/github/callback' })).headers.location).toBe('https://greed.example/?signedIn=1');
    const evil = await app.inject({ url: '/api/auth/github/callback', cookies: { greed_oauth_return: 'https://evil.example' } });
    expect(evil.headers.location).toBe('https://greed.example/?signedIn=1');
  });
});
