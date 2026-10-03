import {
  BedrockAgentCoreControlClient,
  GetGatewayTargetCommand,
  UpdateGatewayTargetCommand,
  type GetGatewayTargetCommandOutput,
} from '@aws-sdk/client-bedrock-agentcore-control';

/** 1.2.0 is the connector release that accepts per-request domain filters. */
export const WEB_SEARCH_VERSION = '1.2.0';

const BUSY = new Set(['CREATING', 'UPDATING', 'SYNCHRONIZING']);
const WAITING_AUTH = new Set(['CREATE_PENDING_AUTH', 'UPDATE_PENDING_AUTH', 'SYNCHRONIZE_PENDING_AUTH']);

export interface PinEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: { GatewayIdentifier: string; TargetId: string; Version: string };
}

interface ControlClient {
  send(command: GetGatewayTargetCommand | UpdateGatewayTargetCommand): Promise<GetGatewayTargetCommandOutput>;
}

/**
 * CloudFormation's ConnectorSource only allows ConnectorId, so the target is
 * created on the connector default and this moves it to the filter release.
 * Delete is a no-op: CloudFormation deletes the target itself.
 */
export async function pinConnectorVersion(
  client: ControlClient,
  gatewayIdentifier: string,
  targetId: string,
  version: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => number = Date.now,
): Promise<void> {
  const deadline = now() + 140_000;
  const current = await settle(client, gatewayIdentifier, targetId, sleep, now, deadline);
  if (current.targetConfiguration?.mcp?.connector?.source?.version === version) return;
  const connector = current.targetConfiguration?.mcp?.connector;
  if (!connector?.source?.connectorId) throw new Error(`Gateway target ${targetId} is not a connector`);
  await client.send(
    new UpdateGatewayTargetCommand({
      gatewayIdentifier,
      targetId,
      name: current.name,
      description: current.description,
      credentialProviderConfigurations: current.credentialProviderConfigurations?.map((item) => ({
        credentialProviderType: item.credentialProviderType,
        ...(item.credentialProvider ? { credentialProvider: item.credentialProvider } : {}),
      })),
      targetConfiguration: {
        mcp: {
          connector: {
            source: { connectorId: connector.source.connectorId, version },
            configurations: connector.configurations,
            enabled: connector.enabled,
          },
        },
      },
    }),
  );
  await settle(client, gatewayIdentifier, targetId, sleep, now, deadline);
}

export async function handlePinEvent(event: PinEvent, client: ControlClient): Promise<{ PhysicalResourceId: string; Data?: { Version: string } } | undefined> {
  const { TargetId, Version } = event.ResourceProperties;
  if (event.RequestType === 'Delete') return { PhysicalResourceId: TargetId };
  await pinConnectorVersion(client, event.ResourceProperties.GatewayIdentifier, TargetId, Version);
  return { PhysicalResourceId: `${TargetId}:${Version}`, Data: { Version } };
}

export async function handler(event: PinEvent) {
  return handlePinEvent(event, new BedrockAgentCoreControlClient({}));
}

async function settle(
  client: ControlClient,
  gatewayIdentifier: string,
  targetId: string,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
  deadline: number,
): Promise<GetGatewayTargetCommandOutput> {
  for (;;) {
    const target = await client.send(new GetGatewayTargetCommand({ gatewayIdentifier, targetId }));
    const status = target.status ?? 'UNKNOWN';
    if (status === 'READY') return target;
    if (WAITING_AUTH.has(status)) throw new Error(`Gateway target ${targetId} is waiting on authorization (${status})`);
    if (!BUSY.has(status)) {
      throw new Error(`Gateway target ${targetId} is ${status}: ${(target.statusReasons ?? []).join('; ')}`);
    }
    if (now() > deadline) throw new Error(`Gateway target ${targetId} still ${status}`);
    await sleep(3_000);
  }
}
