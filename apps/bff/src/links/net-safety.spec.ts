import { describe, expect, it } from 'vitest';
import { guardedLookup, ipLiteral, isPublicAddress } from './net-safety.js';

describe('isPublicAddress', () => {
  it('allows ordinary public addresses in both families', () => {
    for (const ok of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e']) {
      expect(isPublicAddress(ok), ok).toBe(true);
    }
  });

  it('refuses loopback, private, link-local, shared, reserved and multicast IPv4', () => {
    for (const bad of [
      '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '127.255.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255',
      '192.0.0.1', '192.0.2.5', '192.168.1.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    ]) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
    // Just outside the private blocks stays public.
    expect(isPublicAddress('172.32.0.1')).toBe(true);
    expect(isPublicAddress('11.0.0.1')).toBe(true);
  });

  it('refuses loopback, unique-local, link-local, mapped, translated and documentation IPv6', () => {
    for (const bad of ['::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', '2001:db8::1', '2002:7f00:1::1']) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
  });

  it('treats anything that is not an IP address as not public', () => {
    for (const bad of ['', 'localhost', 'example.com', '999.1.1.1', '1.2.3']) expect(isPublicAddress(bad), bad).toBe(false);
  });
});

describe('ipLiteral', () => {
  it('finds IP literals, including bracketed IPv6 and the forms the URL parser normalises', () => {
    expect(ipLiteral(new URL('http://127.0.0.1/'))).toBe('127.0.0.1');
    expect(ipLiteral(new URL('http://[::1]/x'))).toBe('::1');
    expect(ipLiteral(new URL('http://2130706433/'))).toBe('127.0.0.1'); // decimal form
    expect(ipLiteral(new URL('http://0x7f.1/'))).toBe('127.0.0.1'); // hex form
    expect(ipLiteral(new URL('https://example.com/'))).toBeUndefined();
  });
});

describe('guardedLookup', () => {
  const lookup = (addresses: string[] | Error, all = false) =>
    new Promise<unknown[]>((resolve) => {
      const resolver = async () => {
        if (addresses instanceof Error) throw addresses;
        return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
      };
      (guardedLookup(resolver) as unknown as (h: string, o: object, cb: (...a: unknown[]) => void) => void)('example.test', { all }, (...args) => resolve(args));
    });

  it('hands back the vetted addresses, in the shape the caller asked for', async () => {
    expect(await lookup(['93.184.216.34'])).toEqual([null, '93.184.216.34', 4]);
    expect(await lookup(['93.184.216.34', '2606:4700::1111'], true)).toEqual([null, [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1111', family: 6 }]]);
  });

  it('fails the connection when a name resolves to a private address, even if another address is public', async () => {
    for (const set of [['127.0.0.1'], ['93.184.216.34', '10.0.0.5'], ['::1'], ['169.254.169.254']]) {
      const [error] = (await lookup(set)) as [{ code: string; message: string }];
      expect(error).toMatchObject({ code: 'EBLOCKED', message: /non-public/ });
    }
  });

  it('fails when the name resolves to nothing, and passes resolver errors through', async () => {
    expect(((await lookup([])) as [{ code: string }])[0]).toMatchObject({ code: 'EBLOCKED' });
    const failure = Object.assign(new Error('nope'), { code: 'ENOTFOUND' });
    expect(((await lookup(failure)) as [{ code: string }])[0]).toMatchObject({ code: 'ENOTFOUND' });
  });
});
