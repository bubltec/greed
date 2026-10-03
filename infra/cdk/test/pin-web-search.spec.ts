import {
  GetGatewayTargetCommand,
  UpdateGatewayTargetCommand,
  type GetGatewayTargetCommandOutput,
} from '@aws-sdk/client-bedrock-agentcore-control';
import { describe, expect, it, vi } from 'vitest';
import { handlePinEvent, pinConnectorVersion, pinFingerprint, WEB_SEARCH_VERSION } from '../lib/pin-web-search.js';

function target(version: string | undefined, status = 'READY'): GetGatewayTargetCommandOutput {
  return {
    gatewayArn: 'arn:aws:bedrock-agentcore:us-east-1:111:gateway/gw',
    targetId: 'tgt1234567',
    name: 'web-search',
    description: 'search',
    status: status as GetGatewayTargetCommandOutput['status'],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    credentialProviderConfigurations: [{ credentialProviderType: 'GATEWAY_IAM_ROLE' }],
    targetConfiguration: {
      mcp: {
        connector: {
          source: { connectorId: 'web-search', ...(version ? { version } : {}) },
          configurations: [{ name: 'WebSearch', parameterValues: {} }],
        },
      },
    },
  } as GetGatewayTargetCommandOutput;
}

function client(steps: GetGatewayTargetCommandOutput[]) {
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  return {
    sent,
    send: vi.fn(async (command: GetGatewayTargetCommand | UpdateGatewayTargetCommand) => {
      sent.push({ name: command.constructor.name, input: command.input as unknown as Record<string, unknown> });
      if (command instanceof UpdateGatewayTargetCommand) return target(WEB_SEARCH_VERSION);
      const next = steps.shift();
      if (!next) throw new Error('no more gets');
      return next;
    }),
  };
}

describe('pinConnectorVersion', () => {
  it('leaves a target that is already on the filter release', async () => {
    const control = client([target(WEB_SEARCH_VERSION)]);
    await pinConnectorVersion(control, 'gw', 'tgt1234567', WEB_SEARCH_VERSION, async () => {}, () => 0);
    expect(control.sent.map((call) => call.name)).toEqual(['GetGatewayTargetCommand']);
  });

  it('updates the connector default once the target is ready', async () => {
    const control = client([target(undefined, 'CREATING'), target('1.1.0'), target(WEB_SEARCH_VERSION)]);
    const sleep = vi.fn(async () => {});
    await pinConnectorVersion(control, 'gw', 'tgt1234567', WEB_SEARCH_VERSION, sleep, () => 0);
    expect(sleep).toHaveBeenCalledOnce();
    const update = control.sent.find((call) => call.name === 'UpdateGatewayTargetCommand');
    expect(update?.input).toMatchObject({
      gatewayIdentifier: 'gw',
      targetId: 'tgt1234567',
      name: 'web-search',
      credentialProviderConfigurations: [{ credentialProviderType: 'GATEWAY_IAM_ROLE' }],
      targetConfiguration: { mcp: { connector: { source: { connectorId: 'web-search', version: WEB_SEARCH_VERSION } } } },
    });
    expect(control.sent.filter((call) => call.name === 'GetGatewayTargetCommand')).toHaveLength(3);
  });

  it('fails when the target is not a connector or never settles', async () => {
    const broken = {
      send: vi.fn(async () => ({ ...target(undefined), targetConfiguration: undefined }) as GetGatewayTargetCommandOutput),
    };
    await expect(pinConnectorVersion(broken, 'gw', 'tgt', WEB_SEARCH_VERSION, async () => {}, () => 0)).rejects.toThrow(/not a connector/);

    let clock = 0;
    const stuck = { send: vi.fn(async () => target(undefined, 'CREATING')) };
    await expect(
      pinConnectorVersion(
        stuck,
        'gw',
        'tgt',
        WEB_SEARCH_VERSION,
        async () => {
          clock = 200_000;
        },
        () => clock,
      ),
    ).rejects.toThrow(/still CREATING/);
  });
});

describe('handlePinEvent', () => {
  const props = { GatewayIdentifier: 'gw', TargetId: 'tgt1234567', Version: WEB_SEARCH_VERSION, ConfigHash: 'h' };

  it('returns the physical id CloudFormation already holds on Delete, and calls nothing', async () => {
    const send = vi.fn();
    const result = await handlePinEvent(
      { RequestType: 'Delete', PhysicalResourceId: 'tgt1234567', ResourceProperties: props },
      { send },
    );
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ PhysicalResourceId: 'tgt1234567' });
  });

  it('answers a Delete for a resource created under an older physical id with that same id', async () => {
    const result = await handlePinEvent(
      { RequestType: 'Delete', PhysicalResourceId: 'tgt1234567:1.2.0', ResourceProperties: props },
      { send: vi.fn() },
    );
    expect(result).toEqual({ PhysicalResourceId: 'tgt1234567:1.2.0' });
  });

  it('keeps one physical id per target, whatever the version, so a version bump is an in-place update', async () => {
    const created = await handlePinEvent({ RequestType: 'Create', ResourceProperties: props }, client([target(WEB_SEARCH_VERSION)]));
    const bumped = await handlePinEvent(
      { RequestType: 'Update', PhysicalResourceId: 'tgt1234567', ResourceProperties: { ...props, Version: '1.3.0' } },
      client([target(WEB_SEARCH_VERSION), target('1.3.0')]),
    );
    expect(created?.PhysicalResourceId).toBe('tgt1234567');
    expect(bumped?.PhysicalResourceId).toBe('tgt1234567');
    expect(bumped?.Data).toEqual({ Version: '1.3.0' });
  });

  it('re-pins on Update when CloudFormation reset the target to the connector default', async () => {
    const control = client([target(undefined), target(WEB_SEARCH_VERSION)]);
    await handlePinEvent({ RequestType: 'Update', PhysicalResourceId: 'tgt1234567', ResourceProperties: props }, control);
    expect(control.sent.map((call) => call.name)).toContain('UpdateGatewayTargetCommand');
  });
});

describe('pinFingerprint', () => {
  const config = { name: 'web-search', description: 'one', connector: { connectorId: 'web-search' } };

  it('is stable for the same target configuration', () => {
    expect(pinFingerprint(config)).toBe(pinFingerprint({ ...config }));
    expect(pinFingerprint(config)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes when CloudFormation would change the target, so the pin runs again', () => {
    expect(pinFingerprint({ ...config, description: 'two' })).not.toBe(pinFingerprint(config));
    expect(pinFingerprint({ ...config, connector: { connectorId: 'other' } })).not.toBe(pinFingerprint(config));
  });
});
