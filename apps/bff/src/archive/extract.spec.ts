import { describe, expect, it, vi } from 'vitest';
import { MAX_EXTRACTED_CHARS, NoExtractor, TextractExtractor, readSafely } from './extract.js';

const SHA = 'a'.repeat(64);
const file = (mimeType = 'application/pdf') => ({ bytes: new Uint8Array([1, 2, 3]), mimeType, key: `attachments/${SHA}` });
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

describe('TextractExtractor on a multi-page PDF', () => {
  const multiPage = named('UnsupportedDocumentException');
  const page = (n: number, ...text: string[]) => text.map((Text) => ({ BlockType: 'LINE', Text, Page: n }));

  /** Detect fails (several pages); Start returns a job; Get answers from the queue. */
  function jobClient(answers: Record<string, unknown>[], start: Record<string, unknown> = { JobId: 'job-1' }) {
    const queue = [...answers];
    const send = vi.fn(async (command: { constructor: { name: string } }) => {
      switch (command.constructor.name) {
        case 'DetectDocumentTextCommand':
          throw multiPage;
        case 'StartDocumentTextDetectionCommand':
          return start;
        default:
          return queue.shift() ?? { JobStatus: 'IN_PROGRESS' };
      }
    });
    let clock = 0;
    const extractor = new TextractExtractor({ send }, { bucket: 'greed-archive', budgetMs: 5000, pollMs: 1000, sleep: async (ms) => void (clock += ms), now: () => clock });
    return { send, extractor };
  }
  const sent = (send: ReturnType<typeof vi.fn>, name: string) =>
    send.mock.calls.map((c) => c[0] as { constructor: { name: string }; input: Record<string, unknown> }).filter((c) => c.constructor.name === name);

  it('reads it from the archive as a job, keyed by the file hash so a retry joins the same job', async () => {
    const { send, extractor } = jobClient([{ JobStatus: 'IN_PROGRESS' }, { JobStatus: 'SUCCEEDED', Blocks: [...page(2, 'Second page.'), ...page(1, 'First page.', 'Still first.')] }]);
    const out = await extractor.read(file());
    expect(out).toMatchObject({ extractionStatus: 'done', extractedText: 'First page.\nStill first.\n\nSecond page.', note: expect.stringContaining('2 pages') });
    expect(sent(send, 'StartDocumentTextDetectionCommand')[0]!.input).toEqual({
      DocumentLocation: { S3Object: { Bucket: 'greed-archive', Name: `attachments/${SHA}` } },
      ClientRequestToken: SHA,
    });
  });

  it('follows the result pages until there are no more', async () => {
    const { send, extractor } = jobClient([
      { JobStatus: 'SUCCEEDED', Blocks: page(1, 'One.'), NextToken: 'next' },
      { JobStatus: 'SUCCEEDED', Blocks: page(2, 'Two.') },
    ]);
    expect((await extractor.read(file())).extractedText).toBe('One.\n\nTwo.');
    expect(sent(send, 'GetDocumentTextDetectionCommand').map((c) => c.input.NextToken)).toEqual([undefined, 'next']);
  });

  it('says one page when there is one', async () => {
    const { extractor } = jobClient([{ JobStatus: 'SUCCEEDED', Blocks: [{ BlockType: 'LINE', Text: 'Only.' }] }]);
    expect(await extractor.read(file())).toMatchObject({ extractedText: 'Only.', note: expect.stringContaining('1 page:') });
  });

  it('leaves the file pending when the wait runs out, for a retry to finish', async () => {
    const { send, extractor } = jobClient([]);
    expect(await extractor.read(file())).toMatchObject({ extractionStatus: 'pending', note: /still reading.*again in a minute/ });
    expect(sent(send, 'GetDocumentTextDetectionCommand').length).toBeGreaterThan(1);
  });

  it('fails, never "done", when the job fails or only some pages were read', async () => {
    expect(await jobClient([{ JobStatus: 'FAILED', StatusMessage: 'Bad PDF' }]).extractor.read(file())).toMatchObject({ extractionStatus: 'failed', note: 'Textract: Bad PDF' });
    expect(await jobClient([{ JobStatus: 'FAILED' }]).extractor.read(file())).toMatchObject({ note: 'Textract: the job failed' });
    const partial = await jobClient([{ JobStatus: 'PARTIAL_SUCCESS', Blocks: page(1, 'Half.') }]).extractor.read(file());
    expect(partial).toMatchObject({ extractionStatus: 'failed', note: 'Textract: some pages could not be read' });
    expect(partial.extractedText).toBeUndefined();
  });

  it('leaves it pending when the job finds no text, fails when no job starts, keeps only what a row can hold', async () => {
    expect(await jobClient([{ JobStatus: 'SUCCEEDED', Blocks: [] }]).extractor.read(file())).toMatchObject({ extractionStatus: 'pending', note: /No text/ });
    expect(await jobClient([], {}).extractor.read(file())).toMatchObject({ extractionStatus: 'failed', note: /did not start/ });
    const long = await jobClient([{ JobStatus: 'SUCCEEDED', Blocks: page(1, 'x'.repeat(MAX_EXTRACTED_CHARS + 10)) }]).extractor.read(file());
    expect(long.extractedText).toHaveLength(MAX_EXTRACTED_CHARS);
  });

  it('does not start a job without a bucket, or for anything but a PDF', async () => {
    const send = vi.fn(async () => Promise.reject(multiPage));
    expect(await new TextractExtractor({ send }).read(file())).toMatchObject({ extractionStatus: 'pending', note: /single page/ });
    expect(send).toHaveBeenCalledTimes(1);
    const png = vi.fn(async () => Promise.reject(multiPage));
    await new TextractExtractor({ send: png }, { bucket: 'b' }).read(file('image/png'));
    expect(png).toHaveBeenCalledTimes(1);
  });

  it('uses real timers and the clock by default', async () => {
    const send = vi.fn(async (c: { constructor: { name: string } }) => {
      if (c.constructor.name === 'DetectDocumentTextCommand') throw multiPage;
      if (c.constructor.name === 'StartDocumentTextDetectionCommand') return { JobId: 'j' };
      return { JobStatus: 'SUCCEEDED', Blocks: [{ BlockType: 'LINE', Text: 'Fine.' }] };
    });
    expect((await new TextractExtractor({ send }, { bucket: 'b' }).read(file())).extractedText).toBe('Fine.');
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
