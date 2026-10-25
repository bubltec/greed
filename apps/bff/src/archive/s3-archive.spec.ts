import { describe, expect, it, vi } from 'vitest';
import { S3Archive } from './s3-archive.js';

const named = (name: string) => Object.assign(new Error(name), { name });
const input = (send: ReturnType<typeof vi.fn>, call = 0) => (send.mock.calls[call] as unknown as [{ input: Record<string, unknown> }])[0].input;

describe('S3Archive', () => {
  it('writes an object once: the bucket, the content address, the type, and no overwrite', async () => {
    const send = vi.fn(async () => ({}));
    const archive = new S3Archive({ send }, 'greed-archive');
    expect(archive.configured()).toBe(true);
    await archive.put('attachments/abc', { bytes: new Uint8Array([1, 2]), mimeType: 'application/pdf' });
    expect(input(send)).toMatchObject({ Bucket: 'greed-archive', Key: 'attachments/abc', ContentType: 'application/pdf', IfNoneMatch: '*' });
    expect(Array.from(input(send).Body as Uint8Array)).toEqual([1, 2]);
  });

  it('treats an object that is already there as stored, since the key is the hash of the bytes', async () => {
    for (const name of ['PreconditionFailed', 'ConditionalRequestConflict']) {
      const archive = new S3Archive({ send: async () => Promise.reject(named(name)) }, 'b');
      await expect(archive.put('attachments/abc', { bytes: new Uint8Array([1]), mimeType: 'image/png' })).resolves.toBeUndefined();
    }
  });

  it('does not hide a real write failure', async () => {
    const archive = new S3Archive({ send: async () => Promise.reject(named('AccessDenied')) }, 'b');
    await expect(archive.put('k', { bytes: new Uint8Array([1]), mimeType: 'image/png' })).rejects.toThrow('AccessDenied');
    const bare = new S3Archive({ send: async () => Promise.reject({}) }, 'b');
    await expect(bare.put('k', { bytes: new Uint8Array([1]), mimeType: 'image/png' })).rejects.toBeDefined();
  });

  it('reads an object back with its type', async () => {
    const send = vi.fn(async () => ({ Body: { transformToByteArray: async () => new Uint8Array([9, 8]) }, ContentType: 'image/png' }));
    const found = await new S3Archive({ send }, 'greed-archive').get('attachments/abc');
    expect(found).toEqual({ bytes: new Uint8Array([9, 8]), mimeType: 'image/png' });
    expect(input(send)).toEqual({ Bucket: 'greed-archive', Key: 'attachments/abc' });
  });

  it('falls back to a binary type when S3 reports none', async () => {
    const send = async () => ({ Body: { transformToByteArray: async () => new Uint8Array([1]) } });
    expect((await new S3Archive({ send }, 'b').get('k'))?.mimeType).toBe('application/octet-stream');
  });

  it('finds nothing for a missing key or an empty body, and rethrows anything else', async () => {
    expect(await new S3Archive({ send: async () => Promise.reject(named('NoSuchKey')) }, 'b').get('k')).toBeUndefined();
    expect(await new S3Archive({ send: async () => ({}) }, 'b').get('k')).toBeUndefined();
    await expect(new S3Archive({ send: async () => Promise.reject(named('AccessDenied')) }, 'b').get('k')).rejects.toThrow('AccessDenied');
    await expect(new S3Archive({ send: async () => Promise.reject({}) }, 'b').get('k')).rejects.toBeDefined();
  });
});
