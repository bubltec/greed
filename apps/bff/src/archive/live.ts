import { S3Client } from '@aws-sdk/client-s3';
import { TextractClient } from '@aws-sdk/client-textract';
import { type Archive, UnconfiguredArchive } from './archive.js';
import { type Extractor, NoExtractor, TextractExtractor } from './extract.js';
import { S3Archive } from './s3-archive.js';

const region = () => process.env.AWS_REGION ?? 'us-east-1';

/** S3 when the stage has a bucket (`ARCHIVE_BUCKET`, set by CDK), otherwise an archive that says it is not configured. */
export function archiveFromEnv(env: NodeJS.ProcessEnv = process.env): Archive {
  return env.ARCHIVE_BUCKET ? new S3Archive(new S3Client({ region: region() }), env.ARCHIVE_BUCKET) : new UnconfiguredArchive();
}

/** Textract when the stage asks for it (`ARCHIVE_OCR=textract`), otherwise none. */
export function extractorFromEnv(env: NodeJS.ProcessEnv = process.env): Extractor {
  return env.ARCHIVE_OCR === 'textract' ? new TextractExtractor(new TextractClient({ region: region() }), { bucket: env.ARCHIVE_BUCKET }) : new NoExtractor();
}
