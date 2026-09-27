# Deploying greed.bubbletech.io

Same account and pattern as grtzplz and political-sloth. `bubbletech.io` is an existing Route53
zone (owned by political-sloth's `SlothDns`); greed only delegates `greed.bubbletech.io` from it.

| Stack | Deployed by | What |
| --- | --- | --- |
| `GreedDns` | laptop, once | `greed.bubbletech.io` zone, NS-delegated from `bubbletech.io` |
| `GreedCi` | laptop first, then the `production` job | `greed-gha-deploy` OIDC role (mycota `GithubActionsDeployRole`) |
| `GreedDev/*` | `development` job | `dev.greed.bubbletech.io`, Basic-Auth walled, noindex |
| `GreedProd/*` | `production` job, after approval | `greed.bubbletech.io`, WAF rate limit, 5xx alarm |

## One-time setup

From an AWS SSO session with account access, in `infra/cdk`:

1. **DNS.** `pnpm infra:dns`. Copy the `HostedZoneId` output. No registrar step: the
   delegation record is written into `bubbletech.io` automatically.
2. **Push.** `git remote add origin git@github.com:bubltec/greed.git && git push -u origin main`.
   The deploy role already trusts this repo (`GITHUB_REPO` in `lib/config.ts`).
3. **Deploy role.** `npx cdk deploy GreedCi`. Keep the `DeployRoleArn` output.
4. **GitHub settings, mirroring btfp.** From the repo root, with `gh` signed in as a bubltec admin:
   ```bash
   GREED_HOSTED_ZONE_ID=<from step 1> AWS_DEPLOY_ROLE_ARN=<from step 3> \
   GREED_GITHUB_CLIENT_ID=<from step 7, optional now> ./scripts/github-setup.sh
   ```
   Squash-only merges; the `main-merge` ruleset (PR with one approval, `check` status required,
   linear history, no force-push or deletion; admins can bypass only through a PR, so you can merge
   your own PRs but nobody pushes straight to `main`); `development` and `production`
   environments with you as production's required reviewer; the Actions variables and secrets.
5. *(Covered by step 4.)* Variables: `GREED_HOSTED_ZONE_ID`, `GREED_EDITORS`, `GREED_GITHUB_CLIENT_ID`.
   Secrets: `AWS_DEPLOY_ROLE_ARN`, `GREED_DEV_BASIC_AUTH_USER`, `GREED_DEV_BASIC_AUTH_PASSWORD`.
6. **Session secrets** (SSM SecureString, one per environment, never in the repo):
   ```bash
   aws ssm put-parameter --type SecureString --name /greed/dev/jwt-secret  --value "$(openssl rand -hex 32)"
   aws ssm put-parameter --type SecureString --name /greed/prod/jwt-secret --value "$(openssl rand -hex 32)"
   ```
7. **GitHub OAuth app** (github.com → Settings → Developer settings → OAuth Apps): homepage
   `https://greed.bubbletech.io`, callback `https://greed.bubbletech.io/api/auth/github/callback`.
   Put the client id in `GREED_GITHUB_CLIENT_ID` (re-run step 4 with it) and the secret in SSM:
   ```bash
   aws ssm put-parameter --type SecureString --name /greed/prod/github-client-secret --value '<secret>'
   ```
8. Merge to `main`. Dev deploys, the prod diff is posted to the run summary, prod waits for approval.
9. **Seed prod once** (insert-only, safe to re-run):
   ```bash
   CONTENT_TABLE_NAME=greed-prod-content pnpm --filter @greed/seed exec tsx src/run.ts --remote
   ```
   Same for dev with `greed-dev-content`. Dev editors use **Local editor sign-in** behind Basic Auth.
10. Confirm the SNS subscription email for the prod 5xx alarm.
11. **Claude connector.** Add `https://greed.bubbletech.io/api/mcp` as a custom connector in Claude
    (see [mcp.md](mcp.md)). Needs step 7's GitHub sign-in.

## Cost

At low traffic this is close to free: Lambda, HTTP API and on-demand DynamoDB scale to zero.
Fixed costs are the Route53 zone (~$0.50/mo) and the prod WAF web ACL with one rule
(~$6/mo). Dev uses a CloudFront Function for Basic Auth instead of a second WAF.
