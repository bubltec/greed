import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: string;
}

export interface AuthCode {
  codeHash: string;
  clientId: string;
  /** `provider:providerAccountId`, the mycota-auth user the code was issued to. */
  userKey: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  /** Epoch seconds; also the DynamoDB TTL attribute. */
  expiresAt: number;
}

export interface TokenRecord {
  tokenHash: string;
  kind: 'access' | 'refresh';
  clientId: string;
  userKey: string;
  scope: string;
  expiresAt: number;
  createdAt: string;
}

/**
 * Storage for the OAuth server behind the MCP connector. Codes and tokens are
 * stored only as SHA-256 hashes, so a table read never yields a usable secret.
 */
export interface OAuthStore {
  putClient(client: OAuthClient): Promise<void>;
  getClient(clientId: string): Promise<OAuthClient | undefined>;
  putCode(code: AuthCode): Promise<void>;
  /** Reads and deletes in one step, so a code can be redeemed once. */
  takeCode(codeHash: string): Promise<AuthCode | undefined>;
  putToken(token: TokenRecord): Promise<void>;
  getToken(tokenHash: string): Promise<TokenRecord | undefined>;
  /** Reads and deletes: refresh tokens rotate on every use. */
  takeToken(tokenHash: string): Promise<TokenRecord | undefined>;
}

export const OAUTH_STORE = Symbol('OAUTH_STORE');

type Row = Record<string, unknown> & { PK: string; ttl?: number };

export class DynamoOAuthStore implements OAuthStore {
  constructor(
    private readonly db: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  private put(item: Row) {
    return this.db.send(new PutCommand({ TableName: this.tableName, Item: item }));
  }

  private async get<T>(PK: string): Promise<T | undefined> {
    const res = await this.db.send(new GetCommand({ TableName: this.tableName, Key: { PK } }));
    return res.Item ? strip<T>(res.Item as Row) : undefined;
  }

  private async take<T>(PK: string): Promise<T | undefined> {
    const res = await this.db.send(
      new DeleteCommand({ TableName: this.tableName, Key: { PK }, ReturnValues: 'ALL_OLD' }),
    );
    return res.Attributes ? strip<T>(res.Attributes as Row) : undefined;
  }

  putClient(client: OAuthClient) {
    return this.put({ PK: `CLIENT#${client.clientId}`, ...client }).then(() => undefined);
  }
  getClient(clientId: string) {
    return this.get<OAuthClient>(`CLIENT#${clientId}`);
  }
  putCode(code: AuthCode) {
    return this.put({ PK: `CODE#${code.codeHash}`, ttl: code.expiresAt, ...code }).then(() => undefined);
  }
  takeCode(codeHash: string) {
    return this.take<AuthCode>(`CODE#${codeHash}`);
  }
  putToken(token: TokenRecord) {
    return this.put({ PK: `TOKEN#${token.tokenHash}`, ttl: token.expiresAt, ...token }).then(() => undefined);
  }
  getToken(tokenHash: string) {
    return this.get<TokenRecord>(`TOKEN#${tokenHash}`);
  }
  takeToken(tokenHash: string) {
    return this.take<TokenRecord>(`TOKEN#${tokenHash}`);
  }
}

function strip<T>(row: Row): T {
  const { PK: _pk, ttl: _ttl, ...rest } = row;
  return rest as T;
}

/** In-memory fake for tests. */
export class InMemoryOAuthStore implements OAuthStore {
  readonly clients = new Map<string, OAuthClient>();
  readonly codes = new Map<string, AuthCode>();
  readonly tokens = new Map<string, TokenRecord>();

  async putClient(c: OAuthClient) {
    this.clients.set(c.clientId, c);
  }
  async getClient(id: string) {
    return this.clients.get(id);
  }
  async putCode(c: AuthCode) {
    this.codes.set(c.codeHash, c);
  }
  async takeCode(h: string) {
    const c = this.codes.get(h);
    this.codes.delete(h);
    return c;
  }
  async putToken(t: TokenRecord) {
    this.tokens.set(t.tokenHash, t);
  }
  async getToken(h: string) {
    return this.tokens.get(h);
  }
  async takeToken(h: string) {
    const t = this.tokens.get(h);
    this.tokens.delete(h);
    return t;
  }
}
