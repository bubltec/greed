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

  it('keeps parentheses inside URLs', () => {
    const p = parsePoint(
      'He wrote the foreword. (ACLU (https://www.aclu.org/p); Wikipedia (https://en.wikipedia.org/wiki/Kevin_Roberts_(political_strategist)))',
    );
    expect(p.citations).toEqual([
      { label: 'ACLU', url: 'https://www.aclu.org/p' },
      { label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Kevin_Roberts_(political_strategist)' },
    ]);
  });

  it('labels a bare url by host', () => {
    expect(parsePoint('Done. (https://www.example.org/x)').citations).toEqual([
      { label: 'example.org', url: 'https://www.example.org/x' },
    ]);
  });
});

describe('parsePoint edge cases', () => {
  it('leaves text without a trailing parenthetical alone', () => {
    expect(parsePoint('  Plain sentence.  ')).toEqual({ text: 'Plain sentence.', citations: [] });
  });

  it('ignores unbalanced or leading parentheses', () => {
    expect(parsePoint('Closed too early.)').citations).toEqual([]);
    expect(parsePoint('(Whole point in parentheses)').citations).toEqual([]);
  });

  it('requires the parenthetical to follow sentence punctuation', () => {
    expect(parsePoint('He met the donor (NPR)').citations).toEqual([]);
  });

  it('refuses groups whose first part is not capitalised or whose parts are sentences', () => {
    expect(parsePoint('Done. (see below)').citations).toEqual([]);
    expect(parsePoint('Done. (Reuters; It was reported later.)').citations).toEqual([]);
  });

  it('accepts a source that starts with a digit or quote, and drops empty parts', () => {
    expect(parsePoint('Done. (60 Minutes; ; "The Atlantic")').citations).toEqual([
      { label: '60 Minutes' },
      { label: '"The Atlantic"' },
    ]);
  });

  it('labels a url-only group by its host, or by the raw text when the url is malformed', () => {
    expect(parsePoint('Done. ((https://www.example.org/x))').citations).toEqual([
      { label: 'example.org', url: 'https://www.example.org/x' },
    ]);
    expect(parsePoint('Done. (https://exa mple)').citations).toEqual([{ label: 'https://exa mple' }]);
  });

  it('falls back to the url when a url-only group has an unparseable host', () => {
    const p = parsePoint('Done. (https://[bad)');
    expect(p.citations).toEqual([{ label: 'https://[bad', url: 'https://[bad' }]);
  });
});
