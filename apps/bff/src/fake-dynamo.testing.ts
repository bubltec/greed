import {
  BatchWriteCommand,
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

type Item = Record<string, unknown>;

export interface FakeDynamoOptions {
  /** Scan returns this many rows per page, with a LastEvaluatedKey, so pagination is exercised. */
  pageSize?: number;
  /** BatchWrite leaves this many of its requests unprocessed, this many times. */
  unprocessedRounds?: number;
}

/**
 * A DynamoDBDocumentClient that keeps rows in a Map, keyed by PK (and SK when the
 * row has one). Handles only the commands the stores use; anything else throws, so a
 * new command shows up as a failing test rather than a silent no-op.
 */
export function fakeDynamo(options: FakeDynamoOptions = {}) {
  const rows = new Map<string, Item>();
  const commands: string[] = [];
  let unprocessedRounds = options.unprocessedRounds ?? 0;
  const keyOf = (k: Item) => JSON.stringify([k.PK, k.SK ?? null]);

  const send = async (command: unknown): Promise<Item> => {
    commands.push((command as object).constructor.name);
    if (command instanceof PutCommand) {
      rows.set(keyOf(command.input.Item!), structuredClone(command.input.Item!));
      return {};
    }
    if (command instanceof GetCommand) {
      return { Item: structuredClone(rows.get(keyOf(command.input.Key!))) };
    }
    if (command instanceof DeleteCommand) {
      const old = rows.get(keyOf(command.input.Key!));
      rows.delete(keyOf(command.input.Key!));
      return command.input.ReturnValues === 'ALL_OLD' ? { Attributes: old } : {};
    }
    if (command instanceof ScanCommand) {
      const all = [...rows.values()];
      const start = command.input.ExclusiveStartKey ? Number(command.input.ExclusiveStartKey.offset) : 0;
      const size = options.pageSize ?? all.length;
      const page = all.slice(start, start + size);
      const next = start + size;
      return { Items: structuredClone(page), LastEvaluatedKey: next < all.length ? { offset: next } : undefined };
    }
    if (command instanceof BatchWriteCommand) {
      const requests = command.input.RequestItems![Object.keys(command.input.RequestItems!)[0]!]! as { DeleteRequest: { Key: Item } }[];
      if (unprocessedRounds > 0) {
        unprocessedRounds--;
        return { UnprocessedItems: command.input.RequestItems };
      }
      for (const r of requests) rows.delete(keyOf(r.DeleteRequest.Key));
      return { UnprocessedItems: {} };
    }
    throw new Error(`fakeDynamo: unsupported command ${(command as object).constructor.name}`);
  };

  return { db: { send } as unknown as DynamoDBDocumentClient, rows, commands };
}
