/** Max-age is short so edits show up quickly; stale-* keeps the site up if the origin errors. */
export const PUBLIC_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300, stale-if-error=86400';

/**
 * The full dataset. Thirty minutes, so a download is not rebuilt on every request.
 * CloudFront's export cache policy max TTL must stay at least this long
 * (`infra/cdk/lib/web-stack.ts`); a shorter max would clip this header.
 */
export const EXPORT_CACHE_CONTROL = 'public, max-age=1800, stale-while-revalidate=300, stale-if-error=86400';

/** The session cookie CloudFront keys and forwards, so an editor's requests never share a cache entry with readers'. */
export const SESSION_COOKIE = 'greed_session';

/** Unauthenticated read endpoints under /api, cached at CloudFront. Keep in sync with infra/cdk/lib/public-api.ts. */
export const PUBLIC_API_PATHS = ['topics', 'browse', 'graph', 'activity', 'pages', 'export'] as const;

/**
 * Only successful GETs of the public reads, and never an editor preview (`?preview=1` shows
 * drafts and depends on the session), which therefore never gets a cacheable header.
 */
export function isPublicCacheable(method: string, url: string, statusCode: number): boolean {
  if (method !== 'GET' || statusCode !== 200) return false;
  const [path = '', query = ''] = url.split('?');
  if (new URLSearchParams(query).has('preview')) return false;
  // Page HTML and the model/sitemap files. Not in PUBLIC_API_PATHS: those prefixes
  // also cover writes, and these routes are GET-only.
  if (path === '/api/llms.txt' || path === '/api/sitemap.xml' || path === '/api/robots.txt') return true;
  if (path === '/api/html' || path.startsWith('/api/html/')) return true;
  return PUBLIC_API_PATHS.some((name) => path === `/api/${name}` || path.startsWith(`/api/${name}/`));
}

/** Header for a response `isPublicCacheable` already accepted. Export is the long one. */
export function publicCacheControl(url: string): string {
  const path = url.split('?')[0] ?? '';
  return path === '/api/export' ? EXPORT_CACHE_CONTROL : PUBLIC_CACHE_CONTROL;
}
