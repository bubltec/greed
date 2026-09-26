import type { MycotaAuthConfig } from '@bubltec/mycota-auth';
import { requireInProduction, stage, usersTableName } from './env.js';

/**
 * The one place that maps this app's env onto mycota-auth. Called lazily by
 * MycotaAuthModule.forRootAsync, after lambda.ts has pulled the GitHub client
 * secret from SSM (same ordering btfp relies on).
 */
export function buildMycotaAuthConfig(): MycotaAuthConfig {
  const githubId = process.env.GITHUB_CLIENT_ID;
  return {
    jwtSecret: requireInProduction('JWT_SECRET', process.env.JWT_SECRET, 'change-me-in-local-env'),
    webOrigin: requireInProduction('WEB_ORIGIN', process.env.WEB_ORIGIN, 'http://localhost:5175'),
    usersTableName: usersTableName(),
    emailFromAddress: process.env.SES_FROM_ADDRESS ?? 'noreply@greed.bubbletech.io',
    sessionCookieName: 'greed_session',
    stage: stage(),
    awsRegion: process.env.AWS_REGION ?? 'us-east-1',
    github: githubId
      ? {
          clientId: githubId,
          clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
          callbackUrl:
            process.env.GITHUB_CALLBACK_URL ?? 'http://localhost:3002/api/auth/github/callback',
        }
      : undefined,
  };
}
