import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AppStage } from '../lib/app-stage.js';
import { environments } from '../lib/config.js';
import { viewerRequestCode } from '../lib/web-stack.js';

/**
 * Synthesises both stages without AWS credentials. The Lambda image and web
 * assets must exist (turbo builds them first), same as `cdk synth`.
 */
function synth(envName: 'dev' | 'prod') {
  const app = new cdk.App();
  const stage = new AppStage(app, envName === 'dev' ? 'GreedDev' : 'GreedProd', {
    env: { account: '288892511071', region: 'us-east-1' },
    envConfig: environments[envName],
  });
  const stacks = stage.node.children.filter((c): c is cdk.Stack => c instanceof cdk.Stack);
  const byId = (id: string) => Template.fromStack(stacks.find((s) => s.node.id === id)!);
  return { data: byId('Data'), api: byId('Api'), web: byId('Web') };
}

describe('GreedProd', () => {
  const { data, api, web } = synth('prod');

  it('protects prod content', () => {
    data.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'greed-prod-content',
      DeletionProtectionEnabled: true,
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  it('keeps MCP OAuth state in its own expiring table', () => {
    data.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'greed-prod-auth',
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('passes secret names, never secret values, to the Lambda', () => {
    api.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          STAGE: 'prod',
          WEB_ORIGIN: 'https://greed.bubbletech.io',
          JWT_SECRET_PARAM: '/greed/prod/jwt-secret',
        }),
      },
    });
    const vars = JSON.stringify(api.findResources('AWS::Lambda::Function'));
    expect(vars).not.toMatch(/"JWT_SECRET"/);
  });

  it('serves greed.bubbletech.io with /api on the same origin behind a rate limit', () => {
    web.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['greed.bubbletech.io'],
        CacheBehaviors: [
          Match.objectLike({ PathPattern: '/api/*' }),
          Match.objectLike({ PathPattern: '/.well-known/*' }),
        ],
      }),
    });
    web.resourceCountIs('AWS::WAFv2::WebACL', 1);
  });
});

describe('GreedDev', () => {
  const { web } = synth('dev');

  it('walls dev off with basic auth on both behaviors and no WAF', () => {
    web.resourceCountIs('AWS::CloudFront::Function', 2);
    web.resourceCountIs('AWS::WAFv2::WebACL', 0);
    web.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: ['dev.greed.bubbletech.io'] }),
    });
  });
});

describe('viewerRequestCode', () => {
  it('produces a handler that rejects missing credentials and rewrites SPA routes', () => {
    const code = viewerRequestCode({ basicAuth: 'Basic abc', spaFallback: true });
    const handler = new Function(`${code}; return handler;`)() as (e: unknown) => {
      statusCode?: number;
      uri?: string;
    };
    expect(handler({ request: { uri: '/t/x', headers: {} } }).statusCode).toBe(401);
    expect(handler({ request: { uri: '/t/x', headers: { authorization: { value: 'Basic abc' } } } }).uri).toBe('/index.html');
    expect(handler({ request: { uri: '/assets/a.js', headers: { authorization: { value: 'Basic abc' } } } }).uri).toBe('/assets/a.js');
  });
});
