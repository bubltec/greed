import * as dns from 'node:dns';
import * as net from 'node:net';

/**
 * What the link checker may connect to. The checker fetches addresses editors typed into
 * references, so it must never be steered at the Lambda itself or anything private: loopback
 * (the Lambda runtime API lives there), link-local, private and reserved ranges, in both
 * IP families, including IPv4 smuggled inside IPv6.
 */
const BLOCKED = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

/** True for an address on the public internet. Anything that is not an IP at all is not public. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  return !BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** A URL's host as an address when it is an IP literal (`[::1]` loses its brackets), else undefined. */
export function ipLiteral(url: URL): string | undefined {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return net.isIP(host) ? host : undefined;
}

type Resolve = (hostname: string) => Promise<dns.LookupAddress[]>;

const systemResolve: Resolve = (hostname) => dns.promises.lookup(hostname, { all: true });

/**
 * A `lookup` for `http.request` that fails the connection when ANY address the name resolves to is
 * not public. The check sits inside the connection itself, so the address that was vetted is the
 * address that is dialled: a name that resolves differently a moment later cannot slip through.
 * IP literals skip DNS in Node, so callers vet those with `ipLiteral` first.
 */
export function guardedLookup(resolve: Resolve = systemResolve): net.LookupFunction {
  return ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
    resolve(hostname).then(
      (addresses) => {
        const bad = addresses.find((a) => !isPublicAddress(a.address));
        if (addresses.length === 0 || bad) {
          callback(Object.assign(new Error(`${hostname} resolves to a non-public address`), { code: 'EBLOCKED' }));
        } else if (options.all) {
          callback(null, addresses);
        } else {
          callback(null, addresses[0]!.address, addresses[0]!.family);
        }
      },
      (error) => callback(error),
    );
  }) as net.LookupFunction;
}
