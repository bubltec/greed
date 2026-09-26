const PLACEHOLDER = /^(REPLACE_|change-me)/i;

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** The deploy stage: 'local', 'dev' or 'prod'. */
export function stage(): string {
  return process.env.STAGE ?? 'local';
}

/**
 * `value`, or `localDefault` outside production. In production a missing or
 * placeholder value throws: silently falling back there means running with a
 * publicly known secret.
 */
export function requireInProduction(
  name: string,
  value: string | undefined,
  localDefault: string,
): string {
  if (!isProduction()) return value ?? localDefault;
  if (!value || PLACEHOLDER.test(value)) {
    throw new Error(`${name} is missing or still a placeholder; refusing to start in production`);
  }
  return value;
}

/** CORS origin. Reflecting any origin is only allowed locally, since credentials are enabled. */
export function corsOrigin(): string | true {
  const configured = process.env.WEB_ORIGIN;
  if (configured) return configured;
  if (isProduction()) {
    throw new Error('WEB_ORIGIN must be set in production; refusing to reflect any origin');
  }
  return true;
}

export const LOCAL_EDITOR_EMAIL = 'editor@greed.local';

export function contentTableName(): string {
  return process.env.CONTENT_TABLE_NAME ?? 'greed-local-content';
}

export function usersTableName(): string {
  return process.env.USERS_TABLE_NAME ?? 'greed-local-users';
}

/**
 * Who may edit. Entries are emails or `provider:accountId` (e.g.
 * `github:1234567`), comma-separated in EDITORS. Outside prod the local
 * sign-in identity is always an editor.
 */
export function editors(): Set<string> {
  const list = (process.env.EDITORS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (stage() !== 'prod') list.push(LOCAL_EDITOR_EMAIL);
  return new Set(list);
}

/** Read-cache lifetime. Other warm Lambdas see an edit within this window. */
export function cacheTtlMs(): number {
  return Number(process.env.CONTENT_CACHE_TTL_MS ?? 15_000);
}
