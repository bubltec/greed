import {
  AuthService,
  MYCOTA_AUTH_CONFIG,
  type MycotaAuthConfig,
  UsersService,
} from '@bubltec/mycota-auth';
import { Body, Controller, Get, Inject, NotFoundException, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IsEmail, IsOptional } from 'class-validator';
import { LOCAL_EDITOR_EMAIL, isProduction, stage } from '../env.js';
import { isEditor } from './editor.guard.js';

export class LocalSignInDto {
  @IsOptional()
  @IsEmail()
  email?: string;
}

@Controller()
export class SessionController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    @Inject(MYCOTA_AUTH_CONFIG) private readonly config: MycotaAuthConfig,
  ) {}

  /** Who is signed in, if anyone, and whether they can edit. Never 401s. */
  @Get('session')
  async session(@Req() request: FastifyRequest) {
    const token = request.cookies?.[this.config.sessionCookieName ?? 'session'];
    const signIn = {
      github: !!this.config.github?.clientId,
      local: stage() !== 'prod',
    };
    if (!token) return { user: null, editor: false, signIn };
    try {
      const payload = this.auth.verifySessionToken(token);
      const account = await this.users.getByProviderAccount(
        payload.provider,
        payload.providerAccountId,
      );
      if (!account) return { user: null, editor: false, signIn };
      return {
        user: {
          id: account.id,
          displayName: account.displayName,
          email: account.email,
          avatarUrl: account.avatarUrl,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        },
        editor: isEditor(account),
        signIn,
      };
    } catch {
      return { user: null, editor: false, signIn };
    }
  }

  /**
   * Local and dev only (dev sits behind basic auth at the edge). Prod editors
   * sign in with GitHub through mycota-auth's /auth/github.
   */
  @Post('auth/local')
  async local(@Body() body: LocalSignInDto, @Res() reply: FastifyReply) {
    if (stage() === 'prod') throw new NotFoundException();
    const user = await this.users.findOrCreateByEmail(body.email ?? LOCAL_EDITOR_EMAIL);
    reply.setCookie(this.config.sessionCookieName ?? 'session', this.auth.issueSessionToken(user), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction(),
      maxAge: 60 * 60 * 24 * 30,
    });
    return reply.send({ id: user.id, displayName: user.displayName, email: user.email });
  }
}
