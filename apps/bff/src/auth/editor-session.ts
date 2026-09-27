import { Inject, Injectable } from '@nestjs/common';
import {
  AuthService,
  MYCOTA_AUTH_CONFIG,
  type MycotaAuthConfig,
  type User,
  UsersService,
} from '@bubltec/mycota-auth';
import type { FastifyRequest } from 'fastify';
import { isEditor } from './editor.guard.js';

/** Non-throwing session lookup, for routes that are public but behave differently for editors. */
@Injectable()
export class EditorSession {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    @Inject(MYCOTA_AUTH_CONFIG) private readonly config: MycotaAuthConfig,
  ) {}

  async user(request: FastifyRequest): Promise<User | undefined> {
    const token = request.cookies?.[this.config.sessionCookieName ?? 'session'];
    if (!token) return undefined;
    try {
      const payload = this.auth.verifySessionToken(token);
      return (await this.users.getByProviderAccount(payload.provider, payload.providerAccountId)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async isEditor(request: FastifyRequest): Promise<boolean> {
    const user = await this.user(request);
    return !!user && isEditor(user);
  }
}
