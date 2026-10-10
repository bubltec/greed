import { describe, expect, it } from 'vitest';
import { isPublicCacheable, PUBLIC_CACHE_CONTROL } from './public-cache.js';

describe('isPublicCacheable', () => {
  it('marks successful GETs of the public reads', () => {
    for (const url of ['/api/topics', '/api/topics/abc', '/api/browse?q=x&page=2', '/api/graph', '/api/activity', '/api/pages/about', '/api/export']) {
      expect(isPublicCacheable('GET', url, 200), url).toBe(true);
    }
  });

  it('never marks editor previews, errors, other methods, or anything else', () => {
    expect(isPublicCacheable('GET', '/api/topics?preview=1', 200)).toBe(false);
    expect(isPublicCacheable('GET', '/api/browse?q=x&preview=1', 200)).toBe(false);
    expect(isPublicCacheable('GET', '/api/topics/missing', 404)).toBe(false);
    expect(isPublicCacheable('GET', '/api/topics', 500)).toBe(false);
    expect(isPublicCacheable('POST', '/api/topics', 200)).toBe(false);
    for (const url of ['/api/mcp', '/api/session', '/api/drafts', '/api/oauth/authorize', '/api/oauth/register', '/api/health', '/.well-known/oauth-authorization-server', '/api/topicsfoo']) {
      expect(isPublicCacheable('GET', url, 200), url).toBe(false);
    }
  });

  it('allows serving stale on origin errors', () => {
    expect(PUBLIC_CACHE_CONTROL).toMatch(/max-age=60/);
    expect(PUBLIC_CACHE_CONTROL).toMatch(/stale-if-error=\d+/);
  });
});
