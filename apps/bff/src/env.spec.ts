import { afterEach, describe, expect, it } from 'vitest';
import { editors, requireInProduction } from './env.js';

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
    expect([...editors()]).toEqual(['a@x.com', 'github:42']);
    process.env.STAGE = 'dev';
    expect(editors().has('editor@greed.local')).toBe(true);
  });
});
