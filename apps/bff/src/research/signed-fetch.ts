import { defaultProvider } from '@aws-sdk/credential-provider-node';
import type { FetchLike } from '@modelcontextprotocol/client';
import { AwsClient } from 'aws4fetch';

/** Resolved the same way the DynamoDB client resolves them. */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * SigV4 for the AgentCore Gateway. Keys come from the default AWS chain:
 * Lambda's environment, or a local `aws sso login`. A fresh lookup each
 * request so an expired SSO token is replaced.
 */
export function signedFetch(
  region: string,
  fetchImpl: typeof fetch = fetch,
  credentials: () => Promise<AwsCredentials> = defaultProvider(),
): FetchLike {
  return async (input, init) => {
    const creds = await credentials();
    const aws = new AwsClient({
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
      service: 'bedrock-agentcore',
      region,
    });
    return fetchImpl(await aws.sign(input, init));
  };
}
