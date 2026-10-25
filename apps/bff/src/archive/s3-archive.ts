import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { Archive, ArchivedFile } from './archive.js';
import type { Sender } from './extract.js';

/** S3 answers these when `IfNoneMatch: '*'` finds the object already there. */
const ALREADY_THERE = ['PreconditionFailed', 'ConditionalRequestConflict'];

/**
 * The archive on S3. Keys are content addresses, so an object is written once and never
 * replaced: `IfNoneMatch: '*'` makes a second put of the same bytes a no-op, and the bucket
 * is versioned besides. This role can read and write but not delete.
 */
export class S3Archive implements Archive {
  constructor(
    private readonly client: Sender,
    private readonly bucket: string,
  ) {}

  configured() {
    return true;
  }

  async put(key: string, file: ArchivedFile) {
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: file.bytes, ContentType: file.mimeType, IfNoneMatch: '*' }));
    } catch (error) {
      if (!ALREADY_THERE.includes((error as { name?: string }).name ?? '')) throw error;
    }
  }

  async get(key: string) {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!out.Body) return undefined;
      return { bytes: await out.Body.transformToByteArray(), mimeType: out.ContentType ?? 'application/octet-stream' };
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') return undefined;
      throw error;
    }
  }
}
