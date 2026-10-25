import { describe, expect, it } from 'vitest';
import { UnconfiguredArchive } from './archive.js';
import { NoExtractor, TextractExtractor } from './extract.js';
import { archiveFromEnv, extractorFromEnv } from './live.js';
import { S3Archive } from './s3-archive.js';

describe('archiveFromEnv', () => {
  it('uses S3 only when the stage names a bucket', () => {
    expect(archiveFromEnv({ ARCHIVE_BUCKET: 'greed-prod-archive' })).toBeInstanceOf(S3Archive);
    const none = archiveFromEnv({});
    expect(none).toBeInstanceOf(UnconfiguredArchive);
    expect(none.configured()).toBe(false);
    expect(archiveFromEnv({ ARCHIVE_BUCKET: '' })).toBeInstanceOf(UnconfiguredArchive);
  });

  it('reads the process environment by default, which has no bucket under test', () => {
    expect(archiveFromEnv()).toBeInstanceOf(UnconfiguredArchive);
    expect(extractorFromEnv()).toBeInstanceOf(NoExtractor);
  });
});

describe('extractorFromEnv', () => {
  it('uses Textract only when the stage asks for it', () => {
    expect(extractorFromEnv({ ARCHIVE_OCR: 'textract' })).toBeInstanceOf(TextractExtractor);
    expect(extractorFromEnv({ ARCHIVE_OCR: 'other' })).toBeInstanceOf(NoExtractor);
    expect(extractorFromEnv({})).toBeInstanceOf(NoExtractor);
  });
});
