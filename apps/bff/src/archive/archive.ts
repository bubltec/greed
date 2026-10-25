import { BadRequestException } from '@nestjs/common';

export const ARCHIVE = Symbol('ARCHIVE');

export interface ArchivedFile {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * Where archived evidence lives. The BFF depends on this port, never on S3
 * directly, so tests use the in-memory fake and a stage without storage says so
 * instead of pretending. Keys are content addresses (`attachments/<sha256>`), so
 * putting the same bytes twice is harmless and a row can never name another file.
 */
export interface Archive {
  /** False when this stage has no storage, so tools can say so instead of failing mid-way. */
  configured(): boolean;
  put(key: string, file: ArchivedFile): Promise<void>;
  get(key: string): Promise<ArchivedFile | undefined>;
}

/** The archive key for a file, derived from its hash. */
export const archiveKey = (sha256: string) => `attachments/${sha256}`;

/** Tests, and local development without AWS. Nothing survives a restart. */
export class InMemoryArchive implements Archive {
  readonly files = new Map<string, ArchivedFile>();

  configured() {
    return true;
  }

  async put(key: string, file: ArchivedFile) {
    this.files.set(key, { bytes: new Uint8Array(file.bytes), mimeType: file.mimeType });
  }

  async get(key: string) {
    const found = this.files.get(key);
    return found && { bytes: new Uint8Array(found.bytes), mimeType: found.mimeType };
  }
}

/** The default until a stage has storage wired in: reads find nothing, writes are refused with a reason. */
export class UnconfiguredArchive implements Archive {
  configured() {
    return false;
  }

  async put(): Promise<void> {
    throw new BadRequestException('The document archive is not configured for this stage');
  }

  async get() {
    return undefined;
  }
}
