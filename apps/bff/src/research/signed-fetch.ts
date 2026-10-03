import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import type { FetchLike } from '@modelcontextprotocol/client';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';

/** Resolved the same way the DynamoDB client resolves them. */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignedFetchOptions {
  fetchImpl?: typeof fetch;
  credentials?: () => Promise<AwsCredentials>;
  service?: string;
  /** Pinned in tests so a signature can be checked against a published vector. */
  now?: () => Date;
}

/**
 * SigV4 for the AgentCore Gateway, signed with the AWS SDK's own signer. Keys
 * come from the default AWS chain (Lambda's environment, or a local
 * `aws sso login`), which caches them and refreshes before they expire.
 */
export function signedFetch(region: string, options: SignedFetchOptions = {}): FetchLike {
  const fetchImpl = options.fetchImpl ?? fetch;
  const signer = new SignatureV4({
    service: options.service ?? 'bedrock-agentcore',
    region,
    credentials: options.credentials ?? defaultProvider(),
    sha256: Sha256,
    // The x-amz-content-sha256 header is an S3 convention; other services do not expect it.
    applyChecksum: false,
  });
  return async (input, init) => {
    // Request normalizes every input and body type, so what is signed is what is sent.
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.body === null ? undefined : new Uint8Array(await request.arrayBuffer());
    const headers: Record<string, string> = { host: url.host };
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const signed = await signer.sign(
      new HttpRequest({
        method: request.method,
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: url.pathname,
        query: queryOf(url),
        headers,
        body,
      }),
      options.now ? { signingDate: options.now() } : undefined,
    );
    // fetch derives Host from the URL, which is the value that was signed.
    const { host: _host, ...outgoing } = signed.headers;
    return fetchImpl(url, { method: request.method, headers: outgoing, body, signal: request.signal });
  };
}

/** Repeated parameters stay repeated; collapsing them would sign a different request than is sent. */
function queryOf(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  url.searchParams.forEach((value, key) => {
    const seen = query[key];
    query[key] = seen === undefined ? value : [...(Array.isArray(seen) ? seen : [seen]), value];
  });
  return query;
}
