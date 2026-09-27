import {
  AuthService,
  MYCOTA_AUTH_CONFIG,
  type MycotaAuthConfig,
  type User,
  UsersService,
} from '@bubltec/mycota-auth';
import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { editorEmail, isEditor } from '../auth/editor.guard.js';
import { isProduction, LOCAL_EDITOR_EMAIL, stage } from '../env.js';
import { OAuthError, OAuthService } from './oauth.service.js';
import { consentPage, errorPage, signInPage } from './pages.js';
import { RETURN_COOKIE } from './well-known.js';

const AUTHORIZE_PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
  'resource',
] as const;

@Controller('oauth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly auth: AuthService,
    private readonly users: UsersService,
    @Inject(MYCOTA_AUTH_CONFIG) private readonly config: MycotaAuthConfig,
  ) {}

  @Post('register')
  @HttpCode(201)
  async register(@Body() body: Record<string, unknown>, @Res() reply: FastifyReply) {
    try {
      return reply.status(201).send(await this.oauth.register(body ?? {}));
    } catch (err) {
      return sendOAuthError(reply, err);
    }
  }

  @Post('token')
  @HttpCode(200)
  async token(@Body() body: Record<string, unknown>, @Res() reply: FastifyReply) {
    try {
      const tokens = await this.oauth.token(body ?? {});
      return reply.header('cache-control', 'no-store').send(tokens);
    } catch (err) {
      return sendOAuthError(reply, err);
    }
  }

  @Get('authorize')
  async authorizePage(
    @Query() query: Record<string, string>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    let req;
    try {
      req = await this.oauth.validateAuthorize(query);
    } catch (err) {
      return html(reply, 400, errorPage('Can’t connect', message(err)));
    }
    const user = await this.sessionUser(request);
    if (!user) {
      // Come back here after GitHub sign-in (see registerOAuthReturnHook).
      reply.setCookie(RETURN_COOKIE, request.url, {
        path: '/api',
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction(),
        maxAge: 600,
      });
      return html(
        reply,
        200,
        signInPage({ clientName: req.client.clientName, github: !!this.config.github?.clientId, local: stage() !== 'prod' }),
      );
    }
    if (!isEditor(user)) {
      return html(reply, 403, errorPage('Not an editor', `${editorEmail(user) ?? user.displayName} isn’t on the GREED editors list.`));
    }
    const hidden: Record<string, string> = {};
    for (const key of AUTHORIZE_PARAMS) if (query[key]) hidden[key] = query[key];
    hidden.redirect_uri = req.redirectUri;
    return html(
      reply,
      200,
      consentPage({
        clientName: req.client.clientName,
        redirectHost: new URL(req.redirectUri).host,
        user: editorEmail(user) ?? user.displayName,
        hidden,
      }),
    );
  }

  /**
   * The consent form posts here. The session cookie is SameSite=Lax, so a
   * cross-site form post arrives without it and is refused: that is the CSRF
   * protection, and why the user is re-checked here rather than trusted from GET.
   */
  @Post('authorize')
  async authorize(
    @Body() body: Record<string, string>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    let req;
    try {
      req = await this.oauth.validateAuthorize(body ?? {});
    } catch (err) {
      return html(reply, 400, errorPage('Can’t connect', message(err)));
    }
    const user = await this.sessionUser(request);
    if (!user || !isEditor(user)) return html(reply, 403, errorPage('Not signed in', 'Sign in as an editor and try again.'));
    const target = new URL(req.redirectUri);
    if (req.state) target.searchParams.set('state', req.state);
    target.searchParams.set('iss', new URL(this.config.webOrigin).origin);
    if (body.decision !== 'allow') {
      target.searchParams.set('error', 'access_denied');
    } else {
      target.searchParams.set('code', await this.oauth.issueCode(req, `${user.provider}:${user.providerAccountId}`));
    }
    return reply.redirect(target.toString(), 302);
  }

  /** Local and dev only: sign in as the local editor, then resume the authorize page. */
  @Post('local-sign-in')
  async localSignIn(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    if (stage() === 'prod') throw new NotFoundException();
    const user = await this.users.findOrCreateByEmail(LOCAL_EDITOR_EMAIL);
    reply.setCookie(this.config.sessionCookieName ?? 'session', this.auth.issueSessionToken(user), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction(),
      maxAge: 60 * 60 * 24 * 30,
    });
    const back = request.cookies?.[RETURN_COOKIE];
    reply.clearCookie(RETURN_COOKIE, { path: '/api' });
    return reply.redirect(back?.startsWith('/api/oauth/authorize') ? back : '/admin', 302);
  }

  private async sessionUser(request: FastifyRequest): Promise<User | undefined> {
    const token = request.cookies?.[this.config.sessionCookieName ?? 'session'];
    if (!token) return undefined;
    try {
      const payload = this.auth.verifySessionToken(token);
      return (await this.users.getByProviderAccount(payload.provider, payload.providerAccountId)) ?? undefined;
    } catch {
      return undefined;
    }
  }
}

function html(reply: FastifyReply, status: number, body: string) {
  return reply
    .status(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('x-frame-options', 'DENY')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'")
    .send(body);
}

function message(err: unknown) {
  return err instanceof Error ? err.message : 'Something went wrong';
}

function sendOAuthError(reply: FastifyReply, err: unknown) {
  if (err instanceof OAuthError) {
    return reply.status(err.status).header('cache-control', 'no-store').send({ error: err.error, error_description: err.description });
  }
  throw err;
}
