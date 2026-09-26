#!/usr/bin/env node
import 'source-map-support/register.js';
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

new AppStage(app, 'GreedDev', { env, envConfig: environments.dev });
new AppStage(app, 'GreedProd', { env, envConfig: environments.prod });
