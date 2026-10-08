import { BadGatewayException, NotFoundException } from '@nestjs/common';

export interface HttpResponse {
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
export type HttpGet = (url: string, init: { headers: Record<string, string> }) => Promise<HttpResponse>;

export const liveGet: HttpGet = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });

/** Maps an upstream status to an error the model can act on. */
export function ensureOk(res: HttpResponse, provider: string): HttpResponse {
  if (res.status === 404) throw new NotFoundException(`${provider} has no such record`);
  if (res.status === 429) throw new BadGatewayException(`${provider} rate limit reached; try again in a minute`);
  if (res.status === 401 || res.status === 403) throw new BadGatewayException(`${provider} rejected the request (check its credential)`);
  if (res.status < 200 || res.status >= 300) throw new BadGatewayException(`${provider} returned ${res.status}`);
  return res;
}
