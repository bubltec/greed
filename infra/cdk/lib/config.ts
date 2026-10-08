/** Parent zone, owned by political-sloth's SlothDns stack in the same account. */
export const PARENT_DOMAIN = 'bubbletech.io';
export const ROOT_DOMAIN = `greed.${PARENT_DOMAIN}`;

// us-east-1 for everything: CloudFront's ACM certificate and CLOUDFRONT-scope WAF must live here.
export const AWS_REGION = 'us-east-1';
// Same account as btfp/grtzplz/political-sloth (see cdk.context.json).
export const AWS_ACCOUNT = process.env.CDK_DEFAULT_ACCOUNT ?? '288892511071';

/** SSM namespace, mycota-config convention: /greed/{env}/{key}. */
export const SSM_NAMESPACE = 'greed';

// Set after `pnpm infra:dns`, from GreedDns's HostedZoneId output (btfp's pattern:
// app stages can't take a cross-stage reference to the DNS stack).
export const HOSTED_ZONE_ID = process.env.GREED_HOSTED_ZONE_ID ?? 'REPLACE_AFTER_DNS_STACK_DEPLOY';

// The bubltec org has GitHub's immutable-ID OIDC claims on, so the trust policy
// needs `owner@ownerId/repo@repoId` (see grtzplz/btfp). Ids from the GitHub API:
// org bubltec = 310348769, repo bubltec/greed = 1389922719.
export const GITHUB_REPO = 'bubltec@310348769/greed@1389922719';

// Dev sits behind HTTP Basic Auth at the edge; it is not meant to be public.
export const DEV_BASIC_AUTH_USER = process.env.GREED_DEV_BASIC_AUTH_USER ?? 'dev';
export const DEV_BASIC_AUTH_PASSWORD =
  process.env.GREED_DEV_BASIC_AUTH_PASSWORD ?? 'REPLACE_BEFORE_DEPLOYING_DEV';

/**
 * Who may edit (emails or `github:<numeric id>`). Not secret. The session
 * cookie is what's protected; this only decides which signed-in accounts can write.
 */
export const EDITORS = process.env.GREED_EDITORS ?? 'john.josef@gmail.com';

// GitHub OAuth app client id (not secret; every OAuth redirect exposes it).
// Register an OAuth app with callback https://greed.bubbletech.io/api/auth/github/callback.
export const GITHUB_CLIENT_ID = process.env.GREED_GITHUB_CLIENT_ID ?? '';

export const ALERT_EMAIL = process.env.GREED_ALERT_EMAIL ?? 'john.josef@gmail.com';

export interface EnvConfig {
  envName: 'dev' | 'prod';
  domainName: string;
}

export const environments: Record<'dev' | 'prod', EnvConfig> = {
  dev: { envName: 'dev', domainName: `dev.${ROOT_DOMAIN}` },
  prod: { envName: 'prod', domainName: ROOT_DOMAIN },
};

/** SSM SecureString names the Lambda reads at cold start. Created by hand, never in CFN. */
export const ssmParam = (env: string, key: 'jwt-secret' | 'github-client-secret' | 'courtlistener-token') =>
  `/${SSM_NAMESPACE}/${env}/${key}`;
