import { afterEach, describe, expect, it } from 'vitest';
import {
  authTableName,
  cacheTtlMs,
  contentTableName,
  corsOrigin,
  editors,
  isProduction,
  publicOrigin,
  requireInProduction,
  stage,
  usersTableName,
} from './env.js';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('env', () => {
  it('refuses placeholder secrets in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => requireInProduction('JWT_SECRET', 'REPLACE_ME', 'x')).toThrow(/placeholder/);
    expect(requireInProduction('JWT_SECRET', 'real', 'x')).toBe('real');
  });

  it('only adds the local editor outside prod', () => {
    process.env.EDITORS = 'A@x.com, github:42';
    process.env.STAGE = 'prod';
    expect([...editors().keys()]).toEqual(['a@x.com', 'github:42']);
    process.env.STAGE = 'dev';
    expect(editors().has('editor@greed.local')).toBe(true);
  });

  it('reads the email an account entry signs as', () => {
    process.env.EDITORS = 'github:42=Me@Example.com, other@x.com';
    expect(editors().get('github:42')).toBe('me@example.com');
    expect(editors().get('other@x.com')).toBe('');
  });
});

describe('env defaults and production guards', () => {
  it('defaults to a local stage and local tables, and honours overrides', () => {
    delete process.env.STAGE;
    delete process.env.CONTENT_TABLE_NAME;
    delete process.env.USERS_TABLE_NAME;
    delete process.env.AUTH_TABLE_NAME;
    expect(stage()).toBe('local');
    expect([contentTableName(), usersTableName(), authTableName()]).toEqual(['greed-local-content', 'greed-local-users', 'greed-local-auth']);
    process.env.STAGE = 'dev';
    process.env.CONTENT_TABLE_NAME = 'c';
    process.env.USERS_TABLE_NAME = 'u';
    process.env.AUTH_TABLE_NAME = 'a';
    expect(stage()).toBe('dev');
    expect([contentTableName(), usersTableName(), authTableName()]).toEqual(['c', 'u', 'a']);
  });

  it('reads the cache lifetime, defaulting to 15 seconds', () => {
    delete process.env.CONTENT_CACHE_TTL_MS;
    expect(cacheTtlMs()).toBe(15_000);
    process.env.CONTENT_CACHE_TTL_MS = '0';
    expect(cacheTtlMs()).toBe(0);
  });

  it('falls back to local defaults outside production', () => {
    delete process.env.NODE_ENV;
    expect(isProduction()).toBe(false);
    expect(requireInProduction('X', undefined, 'local')).toBe('local');
    expect(requireInProduction('X', 'given', 'local')).toBe('given');
  });

  it('refuses a missing secret in production', () => {
    process.env.NODE_ENV = 'production';
    expect(isProduction()).toBe(true);
    expect(() => requireInProduction('JWT_SECRET', undefined, 'x')).toThrow(/missing/);
  });

  it('only reflects any CORS origin locally', () => {
    delete process.env.WEB_ORIGIN;
    expect(corsOrigin()).toBe(true);
    process.env.WEB_ORIGIN = 'https://greed.example';
    expect(corsOrigin()).toBe('https://greed.example');
    delete process.env.WEB_ORIGIN;
    process.env.NODE_ENV = 'production';
    expect(() => corsOrigin()).toThrow(/WEB_ORIGIN/);
  });

  it('uses the local origin by default and requires WEB_ORIGIN in production', () => {
    delete process.env.WEB_ORIGIN;
    expect(publicOrigin()).toBe('http://localhost:5175');
    process.env.NODE_ENV = 'production';
    expect(() => publicOrigin()).toThrow(/WEB_ORIGIN/);
  });

  it('ignores blank editor entries', () => {
    process.env.EDITORS = ' , a@x.com,,';
    process.env.STAGE = 'prod';
    expect([...editors().keys()]).toEqual(['a@x.com']);
    delete process.env.EDITORS;
    expect([...editors().keys()]).toEqual([]);
  });
});
