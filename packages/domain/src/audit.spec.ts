import { describe, expect, it } from 'vitest';
import { auditContent, repairText, type ContentSnapshot, type Topic } from './index.js';

const NOW = '2026-10-25T00:00:00.000Z';
const at = '2026-01-01T00:00:00.000Z';

function topic(extra: Partial<Topic> = {}): Topic {
  return {
    id: 'alpha', kind: 'case', title: 'Alpha', summary: 'A clean summary.', sections: [], disputed: '', notes: '',
    tags: [], createdAt: at, updatedAt: at, status: 'published', ...extra,
  };
}

function snapshot(extra: Partial<ContentSnapshot> = {}): ContentSnapshot {
  return { topics: [topic()], references: [], perspectives: [], relations: [], outlets: [], pages: [], ...extra };
}

const codes = (value: string, opts?: Parameters<typeof repairText>[1]) => repairText(value, opts).issues.map((i) => i.code);

describe('repairText', () => {
  it('decodes HTML entities and double-encoded entities in prose', () => {
    expect(repairText('Tom &amp; Jerry &#39;s show')).toMatchObject({ after: "Tom & Jerry 's show" });
    expect(codes('Tom &amp; Jerry')).toContain('ENC_HTML_ENTITY');
    const dbl = repairText('Fish &amp;amp; chips');
    expect(dbl.after).toBe('Fish & chips');
    expect(dbl.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['ENC_HTML_ENTITY', 'ENC_DOUBLE']));
    expect(repairText('caf&eacute; &unknown; &#x2019;')).toMatchObject({ after: 'café &unknown; ’' });
  });

  it('decodes percent-encoding in prose but never inside URLs or lone tokens', () => {
    expect(repairText('the rally%20was %E2%80%9Chuge%E2%80%9D today').after).toBe('the rally was “huge” today');
    expect(codes('the rally%20was big')).toContain('ENC_PERCENT');
    const url = 'see [report](https://x.org/a%20b?x=1&amp;y=2) now%20please';
    expect(repairText(url).after).toContain('https://x.org/a%20b?x=1&amp;y=2');
    const lone = repairText('abc%2Fdef');
    expect(lone.after).toBe('abc%2Fdef');
    expect(lone.issues).toContainEqual({ code: 'ENC_PERCENT', confidence: 'medium' });
    expect(repairText('up 50%25 today').after).toBe('up 50% today');
  });

  it('unescapes literal escape sequences, keeping line breaks only in multiline fields', () => {
    expect(repairText('she said \\"no\\" \\u2014 twice').after).toBe('she said "no" — twice');
    expect(codes('a\\"b')).toContain('ESC_QUOTE');
    expect(codes('a\\u2019b')).toContain('ESC_UNICODE');
    expect(repairText('one\\ntwo').after).toBe('one two');
    expect(repairText('one\\ntwo', { multiline: true }).after).toBe('one\ntwo');
    expect(codes('one\\ntwo')).toContain('ESC_NEWLINE');
  });

  it('repairs mojibake, strips control characters, and converts raw HTML', () => {
    expect(repairText('Trumpâ€™s cafÃ© Â©\uFEFF\u200B move\tfast').after).toBe('Trump’s café © move fast');
    expect(codes('Trumpâ€™s')).toContain('MOJIBAKE');
    expect(codes('a\u200Bb')).toContain('CTRL_CHAR');
    expect(repairText('<p>Hello <strong>bold</strong> and <em>soft</em></p>').after).toBe('Hello **bold** and soft');
    expect(repairText('read <a href="https://x.org/y">the filing</a> today').after).toBe('read [the filing](https://x.org/y) today');
    expect(codes('<p>x</p>')).toContain('HTML_TAG');
  });

  it('collapses doubled spaces except in page bodies, and only reports quote mixing and unsupported markup', () => {
    expect(repairText('too  many   spaces , here').after).toBe('too many spaces, here');
    expect(repairText('page  body  stays', { page: true }).after).toBe('page  body  stays');
    const mixed = repairText('He said "hi" and “bye” today');
    expect(mixed.after).toBe('He said "hi" and “bye” today');
    expect(mixed.issues).toContainEqual({ code: 'QUOTE_MIX', confidence: 'low' });
    const heading = repairText('# Big claim\n\ntext');
    expect(heading.issues).toContainEqual({ code: 'UNSUPPORTED_MARKUP', confidence: 'low' });
    expect(repairText('# Big claim\n\ntext', { page: true }).issues).not.toContainEqual(
      expect.objectContaining({ code: 'UNSUPPORTED_MARKUP' }),
    );
    expect(repairText('Perfectly clean prose.')).toEqual({ after: 'Perfectly clean prose.', issues: [] });
  });
});

describe('auditContent', () => {
  it('flags text damage across topics, references, perspectives, relations, outlets and pages with one line each', () => {
    const report = auditContent(snapshot({
      topics: [topic({
        summary: 'Tom &amp; Jerry  did it.',
        sections: [{ id: 's1', label: 'Facts', points: [{ text: 'A point.', refIds: ['r1'] }] }],
        tags: ['oil&amp;gas'],
      })],
      references: [{ id: 'r1', topicId: 'alpha', label: 'NPR', excerpt: 'the \\"quote\\"', createdAt: at, updatedAt: at, status: 'published' }],
      perspectives: [{ id: 'p1', topicId: 'alpha', stance: 'critic', holder: 'ACLU', body: 'Clean body.', refIds: ['r1'], createdAt: at, updatedAt: at, status: 'published' }],
      relations: [{ id: 'rel1', fromId: 'alpha', toId: 'alpha', kind: 'related', note: 'cafÃ© link', provenance: 'editor', createdAt: at, updatedAt: at, status: 'published' }],
      outlets: [{ id: 'o1', name: 'NPR', domain: 'npr.org', paywall: false, accuracy: 'high', bias: 'low', oneSided: false, factual: 'high', note: 'solid  outlet', createdAt: at, updatedAt: at, status: 'published' }],
      pages: [{ id: 'home', draft: { title: 'Home &amp; stuff', body: 'Body\\ntext', updatedAt: at } }],
    }), { now: NOW, categories: ['text'] });
    const byField = new Map(report.findings.map((f) => [`${f.type}:${f.field}:${f.code}`, f]));
    expect(byField.get('topic:summary:ENC_HTML_ENTITY')).toMatchObject({ after: 'Tom & Jerry did it.' });
    expect(byField.get('topic:summary:DOUBLE_SPACE')).toMatchObject({ after: 'Tom & Jerry did it.' });
    expect(byField.get('topic:tags.0:ENC_HTML_ENTITY')).toMatchObject({ after: 'oil&gas' });
    expect(byField.get('reference:excerpt:ESC_QUOTE')).toMatchObject({ after: 'the "quote"' });
    expect(byField.get('relation:note:MOJIBAKE')).toBeDefined();
    expect(byField.get('outlet:note:DOUBLE_SPACE')).toBeDefined();
    expect(byField.get('page:draft.title:ENC_HTML_ENTITY')).toBeDefined();
    expect(byField.get('page:draft.body:ESC_NEWLINE')).toBeDefined();
    for (const f of report.findings) expect(f.line.split('\n')).toHaveLength(1);
    expect(report.findings[0]!.line).toContain('alpha | topic:alpha |');
    expect(report.counts.ENC_HTML_ENTITY).toBeGreaterThanOrEqual(3);
    expect(report.scanned.fields).toBeGreaterThan(8);
  });

  it('scopes by topic ids and status, and can run one category only', () => {
    const snap = snapshot({
      topics: [topic(), topic({ id: 'beta', title: 'Beta &amp; Co', status: 'draft' })],
      references: [{ id: 'r9', topicId: 'beta', label: 'AP &amp; Co', createdAt: at, updatedAt: at, status: 'draft' }],
    });
    const scoped = auditContent(snap, { now: NOW, ids: ['beta'] });
    expect(scoped.findings.length).toBeGreaterThanOrEqual(2);
    expect(scoped.findings.every((f) => f.topicId === 'beta')).toBe(true);
    expect(auditContent(snap, { now: NOW, ids: ['beta'] }).scanned).toMatchObject({ topics: 1, outlets: 0, pages: 0 });
    expect(auditContent(snap, { now: NOW, status: 'published' }).findings).toEqual([]);
    expect(auditContent(snap, { now: NOW, categories: ['structure'] }).findings.every((f) => f.category === 'structure')).toBe(true);
  });

  it('flags uncited points, orphan references, near-duplicate perspectives and draft children of published topics', () => {
    const report = auditContent(snapshot({
      topics: [topic({ sections: [{ id: 's1', label: 'F', points: [{ text: 'Uncited claim.', refIds: [] }] }] })],
      references: [
        { id: 'r1', topicId: 'alpha', label: 'Used', createdAt: at, updatedAt: at, status: 'draft' },
        { id: 'r2', topicId: 'alpha', label: 'Orphan', createdAt: at, updatedAt: at, status: 'published' },
      ],
      perspectives: [
        { id: 'p1', topicId: 'alpha', stance: 'defender', holder: 'Habba', body: 'The president did nothing wrong and the case is a witch hunt by democrats', refIds: [], createdAt: at, updatedAt: at, status: 'published' },
        { id: 'p2', topicId: 'alpha', stance: 'defender', holder: 'Habba', body: 'The president did nothing wrong and the case is a witch hunt by democrats!', refIds: [], createdAt: at, updatedAt: at, status: 'published' },
      ],
    }), { now: NOW, categories: ['structure'] });
    const found = (code: string) => report.findings.filter((f) => f.code === code);
    expect(found('POINT_NO_CITATION')).toHaveLength(1);
    expect(found('REF_ORPHAN').map((f) => f.id)).toEqual(['r1', 'r2']);
    expect(found('PERSPECTIVE_NEAR_DUP')).toHaveLength(1);
    expect(found('PERSPECTIVE_NEAR_DUP')[0]!.message).toContain('p1');
    expect(found('PUBLISHED_WITH_DRAFT_CHILD').map((f) => f.id)).toEqual(['r1']);
    // Thesis points are exempt from the citation rule.
    const thesis = auditContent(snapshot({ topics: [topic({ kind: 'thesis', sections: [{ id: 's', label: 'F', points: [{ text: 'Claim.', refIds: [] }] }] })] }), { now: NOW, categories: ['structure'] });
    expect(thesis.findings.filter((f) => f.code === 'POINT_NO_CITATION')).toEqual([]);
  });

  it('flags stale "as of" dates and old pending language, but not fresh entries', () => {
    const stale = auditContent(snapshot({
      topics: [
        topic({ notes: 'As of January 2025, the trial is pending.' }),
        topic({ id: 'beta', title: 'Beta', notes: 'Verdict still pending.', updatedAt: at }),
        topic({ id: 'gamma', title: 'Gamma', notes: 'As of October 2026, current.', updatedAt: NOW }),
      ],
    }), { now: NOW, categories: ['staleness'] });
    expect(stale.findings.map((f) => f.id).sort()).toEqual(['alpha', 'beta']);
    expect(stale.findings[0]).toMatchObject({ code: 'STALE_DATE', confidence: 'low' });
    expect(stale.findings[0]!.message).toContain('January 2025');
    expect(auditContent(snapshot(), { now: NOW, staleDays: 100000 }).findings).toEqual([]);
  });

  it('returns an empty report for clean content', () => {
    expect(auditContent(snapshot(), { now: NOW })).toMatchObject({ total: 0, counts: {}, findings: [] });
  });
});
