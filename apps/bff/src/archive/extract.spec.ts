import { describe, expect, it, vi } from 'vitest';
import { MAX_EXTRACTED_CHARS, NoExtractor, TextractExtractor, readSafely } from './extract.js';

const file = (mimeType = 'application/pdf') => ({ bytes: new Uint8Array([1, 2, 3]), mimeType });
const named = (name: string) => Object.assign(new Error(name), { name });
const lines = (...text: string[]) => ({ Blocks: [{ BlockType: 'PAGE' }, ...text.map((Text) => ({ BlockType: 'LINE', Text })), { BlockType: 'WORD', Text: 'ignored' }] });

describe('TextractExtractor', () => {
  it('reports itself as configured', () => {
    expect(new TextractExtractor({ send: vi.fn() }).configured()).toBe(true);
  });

  it('sends the file bytes and joins the lines it reads, ignoring page and word blocks', async () => {
    const send = vi.fn(async () => lines('Addendum', 'The order continues.'));
    const out = await new TextractExtractor({ send }).read(file());
    expect(out).toMatchObject({ extractionStatus: 'done', extractedText: 'Addendum\nThe order continues.' });
    expect(out.note).toMatch(/check it against the file/);
    const command = (send.mock.calls[0] as unknown as [{ input: { Document: { Bytes: Uint8Array } } }])[0];
    expect(Array.from(command.input.Document.Bytes)).toEqual([1, 2, 3]);
  });

  it('keeps no more than the row can hold', async () => {
    const out = await new TextractExtractor({ send: async () => lines('x'.repeat(MAX_EXTRACTED_CHARS + 50)) }).read(file('image/png'));
    expect(out.extractedText).toHaveLength(MAX_EXTRACTED_CHARS);
  });

  it('leaves a file with no text pending, never "done" without text', async () => {
    for (const reply of [{}, { Blocks: [] }, lines('   ')]) {
      expect(await new TextractExtractor({ send: async () => reply }).read(file())).toMatchObject({ extractionStatus: 'pending', note: /No text/ });
    }
  });

  it('does not call Textract for a type it cannot read', async () => {
    const send = vi.fn();
    expect(await new TextractExtractor({ send }).read(file('image/webp'))).toMatchObject({ extractionStatus: 'pending', note: /image\/webp cannot be read/ });
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves a document it cannot read inline, such as a multi-page PDF, pending with a way forward', async () => {
    for (const name of ['UnsupportedDocumentException', 'BadDocumentException', 'DocumentTooLargeException']) {
      const out = await new TextractExtractor({ send: async () => Promise.reject(named(name)) }).read(file());
      expect(out).toMatchObject({ extractionStatus: 'pending', note: /single page.*update_attachment/ });
    }
  });

  it('lets any other error through, for readSafely to report', async () => {
    await expect(new TextractExtractor({ send: async () => Promise.reject(named('ThrottlingException')) }).read(file())).rejects.toThrow('ThrottlingException');
  });
});

describe('readSafely', () => {
  it('turns a failure into a retryable outcome instead of throwing', async () => {
    const failing = new TextractExtractor({ send: async () => Promise.reject(named('ThrottlingException')) });
    expect(await readSafely(failing, file())).toEqual({ extractionStatus: 'failed', note: 'Text extraction failed: ThrottlingException' });
    expect(await readSafely({ configured: () => true, read: async () => Promise.reject('boom') }, file())).toMatchObject({ extractionStatus: 'failed', note: /unknown error/ });
  });

  it('passes a good outcome through', async () => {
    expect(await readSafely(new TextractExtractor({ send: async () => lines('Hi') }), file())).toMatchObject({ extractionStatus: 'done', extractedText: 'Hi' });
  });
});

describe('NoExtractor', () => {
  it('is not configured and says why', async () => {
    const none = new NoExtractor();
    expect(none.configured()).toBe(false);
    expect(await none.read()).toMatchObject({ extractionStatus: 'pending', note: /not configured/ });
  });
});
