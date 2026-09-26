import { describe, expect, it } from 'vitest';
import { slugify, uniqueSlug } from './ids.js';

describe('slugify', () => {
  it('makes readable url-safe ids', () => {
    expect(slugify("Hegseth's Pentagon: spending vs. food")).toBe('hegseths-pentagon-spending-vs-food');
    expect(slugify('   ')).toBe('untitled');
  });

  it('avoids collisions', () => {
    expect(uniqueSlug('A b', new Set(['a-b', 'a-b-2']))).toBe('a-b-3');
  });
});
