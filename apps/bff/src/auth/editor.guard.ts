import { type ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  AuthService,
  type AuthenticatedUser,
  JwtAuthGuard,
  MYCOTA_AUTH_CONFIG,
  type MycotaAuthConfig,
  UsersService,
} from '@bubltec/mycota-auth';
import { editors } from '../env.js';

export interface Editor extends AuthenticatedUser {
  email?: string;
}

/**
 * Signed in (mycota's JwtAuthGuard) *and* on the EDITORS allowlist, matched
 * by email or by `provider:accountId`. The allowlist is checked against the
 * live user row, not JWT claims, so removing someone takes effect immediately.
 */
@Injectable()
export class EditorGuard extends JwtAuthGuard {
  constructor(
    auth: AuthService,
    @Inject(MYCOTA_AUTH_CONFIG) config: MycotaAuthConfig,
    private readonly users: UsersService,
  ) {
    super(auth, config);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    super.canActivate(context);
    const request = context.switchToHttp().getRequest<{ user: Editor }>();
    const account = await this.users.getByProviderAccount(
      request.user.provider,
      request.user.providerAccountId,
    );
    if (!account || !isEditor(account)) {
      throw new ForbiddenException('Your account is not on the editors list');
    }
    request.user.email = editorEmail(account);
    request.user.displayName = account.displayName;
    return true;
  }
}

type Account = { provider: string; providerAccountId: string; email?: string; displayName?: string };

export function isEditor(account: Account): boolean {
  const allowed = editors();
  return (
    allowed.has(`${account.provider}:${account.providerAccountId}`.toLowerCase()) ||
    (!!account.email && allowed.has(account.email.toLowerCase()))
  );
}

/**
 * The email an editor's changes are recorded under: the one their EDITORS
 * entry names, else the address the sign-in provider returned.
 */
export function editorEmail(account: Account): string | undefined {
  const signAs = editors().get(`${account.provider}:${account.providerAccountId}`.toLowerCase());
  return signAs || account.email;
}

/** Attribution stored on edited rows. */
export function editorName(user: Editor): string {
  return user.email ?? user.displayName;
}
