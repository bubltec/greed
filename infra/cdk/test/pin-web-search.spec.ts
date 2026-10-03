import {
  GetGatewayTargetCommand,
  UpdateGatewayTargetCommand,
  type GetGatewayTargetCommandOutput,
} from '@aws-sdk/client-bedrock-agentcore-control';
import { describe, expect, it, vi } from 'vitest';
import { handlePinEvent, pinConnectorVersion, WEB_SEARCH_VERSION } from '../lib/pin-web-search.js';

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
  it('does not call AWS when the custom resource is deleted', async () => {
    const send = vi.fn();
    const result = await handlePinEvent(
      { RequestType: 'Delete', ResourceProperties: { GatewayIdentifier: 'gw', TargetId: 'tgt', Version: WEB_SEARCH_VERSION } },
      { send },
    );
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ PhysicalResourceId: 'tgt' });
  });

  it('reports the pinned version', async () => {
    const control = client([target(WEB_SEARCH_VERSION)]);
    const result = await handlePinEvent(
      { RequestType: 'Create', ResourceProperties: { GatewayIdentifier: 'gw', TargetId: 'tgt1234567', Version: WEB_SEARCH_VERSION } },
      control,
    );
    expect(result).toEqual({ PhysicalResourceId: `tgt1234567:${WEB_SEARCH_VERSION}`, Data: { Version: WEB_SEARCH_VERSION } });
  });
});
