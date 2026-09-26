import { FastifyAdapter } from '@nestjs/platform-fastify';
import awsLambdaFastify from '@fastify/aws-lambda';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createApp } from './app.js';

type Proxy = (event: unknown, context: unknown) => Promise<unknown>;
let proxy: Proxy | undefined;

/**
 * Secrets live in SSM SecureStrings, not in CloudFormation or the Lambda
 * console. Fetched once per cold start, before createApp() resolves
 * MycotaAuthModule's config (btfp's pattern).
 */
async function loadSecrets(): Promise<void> {
  const wanted: [envName: string, paramEnv: string][] = [
    ['GITHUB_CLIENT_SECRET', 'GITHUB_CLIENT_SECRET_PARAM'],
    ['JWT_SECRET', 'JWT_SECRET_PARAM'],
  ];
  const ssm = new SSMClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  for (const [envName, paramEnv] of wanted) {
    const name = process.env[paramEnv];
    if (!name || process.env[envName]) continue;
    const result = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    if (result.Parameter?.Value) process.env[envName] = result.Parameter.Value;
  }
}

async function bootstrap(): Promise<Proxy> {
  await loadSecrets();
  const adapter = new FastifyAdapter();
  const app = await createApp(adapter);
  await app.init();
  return awsLambdaFastify(adapter.getInstance()) as Proxy;
}

export const handler = async (event: unknown, context: unknown) => {
  proxy ??= await bootstrap();
  return proxy(event, context);
};
