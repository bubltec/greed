import { describe, expect, it } from 'vitest';
import { newId, slugify, uniqueSlug } from './ids.js';

describe('slugify', () => {
  it('makes readable url-safe ids', () => {
    expect(slugify("Hegseth's Pentagon: spending vs. food")).toBe('hegseths-pentagon-spending-vs-food');
    expect(slugify('   ')).toBe('untitled');
  });

  it('avoids collisions', () => {
    expect(uniqueSlug('A b', new Set(['a-b', 'a-b-2']))).toBe('a-b-3');
  });
});

describe('newId', () => {
  it('prefixes a short random id', () => {
    const a = newId('ref');
    expect(a).toMatch(/^ref_[0-9a-f]{12}$/);
    expect(newId('ref')).not.toBe(a);
  });
});
