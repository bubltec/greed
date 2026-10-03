import { describe, expect, it } from 'vitest';
import type { Outlet } from './entities.js';
import { compareOutlets, hostMatches, normalizeDomain, outletSearchLists, rankOutlets } from './outlets.js';

const at = '2026-01-01T00:00:00.000Z';

function outlet(partial: Partial<Outlet> & Pick<Outlet, 'name' | 'domain'>): Outlet {
  return {
    id: partial.domain.replace(/\./g, '-'),
    paywall: false,
    accuracy: 'mixed',
    bias: 'mixed',
    oneSided: false,
    factual: 'mixed',
    createdAt: at,
    updatedAt: at,
    status: 'published',
    ...partial,
  };
}

describe('normalizeDomain', () => {
  it('keeps a host and strips the scheme, www and path', () => {
    expect(normalizeDomain('NPR.org')).toBe('npr.org');
    expect(normalizeDomain('https://www.npr.org/sections/news')).toBe('npr.org');
  });

  it('rejects a label that is not a host', () => {
    expect(() => normalizeDomain('NPR')).toThrow(/Not a domain/);
    expect(() => normalizeDomain('')).toThrow(/Not a domain/);
  });
});

describe('rankOutlets', () => {
  it('puts paywalled outlets last, then better accuracy, less bias, both sides, more factual', () => {
    const paywalled = outlet({ name: 'Post', domain: 'washingtonpost.com', paywall: true, accuracy: 'high', factual: 'high' });
    const best = outlet({ name: 'NPR', domain: 'npr.org', accuracy: 'high', bias: 'low', factual: 'high' });
    const biased = outlet({ name: 'Lean', domain: 'lean.example', accuracy: 'high', bias: 'high', factual: 'high' });
    const oneSided = outlet({ name: 'Side', domain: 'side.example', accuracy: 'high', bias: 'low', oneSided: true, factual: 'high' });
    const loose = outlet({ name: 'Rumor', domain: 'rumor.example', accuracy: 'low', factual: 'low' });
    expect(rankOutlets([paywalled, loose, oneSided, biased, best]).map((o) => o.name)).toEqual([
      'NPR',
      'Side',
      'Lean',
      'Rumor',
      'Post',
    ]);
    expect(compareOutlets(best, paywalled)).toBeLessThan(0);
  });
});

describe('outletSearchLists', () => {
  it('searches published open outlets and excludes every paywall', () => {
    const lists = outletSearchLists([
      outlet({ name: 'NPR', domain: 'npr.org', accuracy: 'high' }),
      outlet({ name: 'Draft', domain: 'draft.example', status: 'draft', accuracy: 'high' }),
      outlet({ name: 'CNN', domain: 'cnn.com', paywall: true, status: 'draft' }),
    ]);
    expect(lists.include).toEqual(['npr.org']);
    expect(lists.exclude).toEqual(['cnn.com']);
  });

  it('matches a result host to the outlet domain', () => {
    expect(hostMatches('www.npr.org', 'npr.org')).toBe(true);
    expect(hostMatches('feeds.npr.org', 'npr.org')).toBe(true);
    expect(hostMatches('notnpr.org', 'npr.org')).toBe(false);
  });
});
