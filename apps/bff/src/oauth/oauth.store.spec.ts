import { describe, expect, it } from 'vitest';
import { fakeDynamo } from '../fake-dynamo.testing.js';
import { DynamoOAuthStore } from './oauth.store.js';

const client = { clientId: 'c1', clientName: 'Claude', redirectUris: ['https://claude.ai/cb'], createdAt: '2026-01-01T00:00:00.000Z' };
const code = { codeHash: 'h1', clientId: 'c1', userKey: 'github:1', redirectUri: 'https://claude.ai/cb', codeChallenge: 'x', scope: 'greed', expiresAt: 1_900_000_000 };
const token = { tokenHash: 't1', kind: 'refresh' as const, clientId: 'c1', userKey: 'github:1', scope: 'greed', expiresAt: 1_900_000_000, createdAt: '2026-01-01T00:00:00.000Z' };

describe('DynamoOAuthStore', () => {
  it('stores clients, and strips key attributes on read', async () => {
    const { db } = fakeDynamo();
    const store = new DynamoOAuthStore(db, 'auth');
    expect(await store.getClient('c1')).toBeUndefined();
    await store.putClient(client);
    expect(await store.getClient('c1')).toEqual(client);
  });

  it('lets a code be redeemed once, and sets the TTL attribute', async () => {
    const { db, rows } = fakeDynamo();
    const store = new DynamoOAuthStore(db, 'auth');
    await store.putCode(code);
    expect(rows.get(JSON.stringify(['CODE#h1', null]))).toMatchObject({ ttl: code.expiresAt });
    expect(await store.takeCode('h1')).toEqual(code);
    expect(await store.takeCode('h1')).toBeUndefined();
  });

  it('reads tokens without consuming them, and rotates (takes) refresh tokens', async () => {
    const { db } = fakeDynamo();
    const store = new DynamoOAuthStore(db, 'auth');
    await store.putToken(token);
    expect(await store.getToken('t1')).toEqual(token);
    expect(await store.getToken('t1')).toEqual(token);
    expect(await store.takeToken('t1')).toEqual(token);
    expect(await store.getToken('t1')).toBeUndefined();
    expect(await store.takeToken('t1')).toBeUndefined();
  });
});
