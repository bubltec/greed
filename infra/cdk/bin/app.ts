#!/usr/bin/env node
import 'source-map-support/register.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import { AppStage } from '../lib/app-stage.js';
import { CiStack } from '../lib/ci-stack.js';
import { AWS_ACCOUNT, AWS_REGION, environments, PARENT_DOMAIN, ROOT_DOMAIN } from '../lib/config.js';
import { DnsStack } from '../lib/dns-stack.js';

const app = new cdk.App();
const env = { account: AWS_ACCOUNT, region: AWS_REGION };

// Once, from a laptop: the greed.bubbletech.io zone, delegated from bubbletech.io.
new DnsStack(app, 'GreedDns', { env, parentDomain: PARENT_DOMAIN, domainName: ROOT_DOMAIN });
// Once from a laptop, then by the production job: the GitHub Actions deploy role.
new CiStack(app, 'GreedCi', { env });

// The app stages package the built web app and BFF bundle, and CDK synthesises
// every stack even when you deploy just one. Without the builds, leave the stages
// out so `pnpm infra:dns` / GreedCi work from a fresh clone; `pnpm infra:dev` and
// CI build first.
const built = ['../../../apps/web/dist/index.html', '../../../apps/bff/dist/lambda.js'].every((rel) =>
  existsSync(fileURLToPath(new URL(rel, import.meta.url))),
);
if (built) {
  new AppStage(app, 'GreedDev', { env, envConfig: environments.dev });
  new AppStage(app, 'GreedProd', { env, envConfig: environments.prod });
} else {
  console.warn(
    'GreedDev/GreedProd skipped: apps/web and apps/bff are not built. ' +
      'Run `pnpm turbo run build` (or `pnpm infra:dev`, which builds first) to deploy them.',
  );
}
