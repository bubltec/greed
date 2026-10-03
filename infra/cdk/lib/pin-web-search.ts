import { createHash } from 'node:crypto';
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
  /** Present on Update and Delete: the id CloudFormation already holds for this resource. */
  PhysicalResourceId?: string;
  ResourceProperties: { GatewayIdentifier: string; TargetId: string; Version: string; ConfigHash?: string };
}

/**
 * CloudFormation resets the connector version whenever it updates the target,
 * and does not know a pin exists. Putting this in the custom resource's
 * properties makes any change to the target re-run the pin.
 */
export function pinFingerprint(targetConfig: unknown): string {
  return createHash('sha256').update(JSON.stringify(targetConfig)).digest('hex').slice(0, 16);
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

/**
 * One physical id per target, whatever the version: a version bump is an
 * in-place Update, not a replacement. CloudFormation's provider framework
 * rejects a Delete that answers with a different id, so Delete echoes the one
 * it was given.
 */
export async function handlePinEvent(event: PinEvent, client: ControlClient): Promise<{ PhysicalResourceId: string; Data?: { Version: string } } | undefined> {
  const { TargetId, Version } = event.ResourceProperties;
  if (event.RequestType === 'Delete') return { PhysicalResourceId: event.PhysicalResourceId ?? TargetId };
  await pinConnectorVersion(client, event.ResourceProperties.GatewayIdentifier, TargetId, Version);
  return { PhysicalResourceId: TargetId, Data: { Version } };
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
