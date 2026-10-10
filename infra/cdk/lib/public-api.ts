/** Unauthenticated read endpoints under /api, cached at CloudFront. Keep in sync with apps/bff/src/public-cache.ts. */
export const PUBLIC_API_PATHS = ['topics', 'browse', 'graph', 'activity', 'pages', 'export'] as const;

/** The editor session cookie: part of the cache key and forwarded, so editor previews stay per-session. */
export const SESSION_COOKIE = 'greed_session';
