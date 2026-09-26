import { describe, expect, it } from 'vitest';
import { parsePoint } from './citations.js';

describe('parsePoint', () => {
  it('splits trailing source groups with and without urls', () => {
    const p = parsePoint(
      'Spending rose sharply. (Sludge (https://readsludge.com/a); CB Insights (https://cbinsights.com/b); NPR)',
    );
    expect(p.text).toBe('Spending rose sharply.');
    expect(p.citations).toEqual([
      { label: 'Sludge', url: 'https://readsludge.com/a' },
      { label: 'CB Insights', url: 'https://cbinsights.com/b' },
      { label: 'NPR' },
    ]);
  });

  it('keeps mid-sentence parentheticals as prose', () => {
    const input = 'The second largest donor (the National Association of Realtors) gave more';
    expect(parsePoint(input)).toEqual({ text: input, citations: [] });
  });

  it('keeps a trailing aside that is not source-like', () => {
    const input = 'He said it twice. (this was later walked back by the press office.)';
    expect(parsePoint(input).citations).toEqual([]);
  });

  it('labels a bare url by host', () => {
    expect(parsePoint('Done. (https://www.example.org/x)').citations).toEqual([
      { label: 'example.org', url: 'https://www.example.org/x' },
    ]);
  });
});
