import { afterEach, describe, expect, it } from 'vitest';
import { buildMycotaAuthConfig } from './mycota-config.js';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('buildMycotaAuthConfig', () => {
  it('maps the environment onto mycota-auth, with local defaults', () => {
    for (const k of ['JWT_SECRET', 'WEB_ORIGIN', 'SES_FROM_ADDRESS', 'AWS_REGION', 'GITHUB_CLIENT_ID', 'STAGE']) delete process.env[k];
    delete process.env.NODE_ENV;
    expect(buildMycotaAuthConfig()).toMatchObject({
      jwtSecret: 'change-me-in-local-env',
      webOrigin: 'http://localhost:5175',
      sessionCookieName: 'greed_session',
      stage: 'local',
      awsRegion: 'us-east-1',
      emailFromAddress: 'noreply@greed.bubbletech.io',
      github: undefined,
    });
  });

  it('enables GitHub sign-in only when a client id is set', () => {
    process.env.GITHUB_CLIENT_ID = 'abc';
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GITHUB_CALLBACK_URL;
    expect(buildMycotaAuthConfig().github).toEqual({
      clientId: 'abc',
      clientSecret: '',
      callbackUrl: 'http://localhost:3002/api/auth/github/callback',
    });
    process.env.GITHUB_CLIENT_SECRET = 's';
    process.env.GITHUB_CALLBACK_URL = 'https://greed.example/cb';
    process.env.JWT_SECRET = 'j';
    process.env.AWS_REGION = 'eu-west-1';
    expect(buildMycotaAuthConfig()).toMatchObject({
      jwtSecret: 'j',
      awsRegion: 'eu-west-1',
      github: { clientSecret: 's', callbackUrl: 'https://greed.example/cb' },
    });
  });
});
