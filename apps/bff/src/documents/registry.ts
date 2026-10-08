import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { DocumentProvider, DocumentRef, SearchOptions, SourceDocument } from './types.js';

export interface ProviderSummary {
  id: string;
  name: string;
  hosts: readonly string[];
  kinds: readonly string[];
  configured: boolean;
}

/**
 * Every document provider in one place. URLs are routed by host to the provider
 * that owns it; a URL no provider claims is refused, so nothing here can be
 * pointed at an arbitrary address.
 */
export class DocumentProviders {
  constructor(private readonly providers: readonly DocumentProvider[]) {}

  list(): ProviderSummary[] {
    return this.providers.map((p) => ({ id: p.id, name: p.name, hosts: p.hosts, kinds: p.kinds, configured: p.configured() }));
  }

  /** Searches one provider, or every configured provider that has the kind when none is named. */
  async search(query: string, options: SearchOptions & { provider?: string }): Promise<{ hits: DocumentRef[]; errors: { provider: string; error: string }[] }> {
    const chosen = options.provider ? [this.byId(options.provider)] : this.providers.filter((p) => !options.kind || p.kinds.includes(options.kind));
    const usable = chosen.filter((p) => p.configured());
    if (options.provider && usable.length === 0) throw new BadRequestException(`${options.provider} is not configured for this stage`);
    const settled = await Promise.allSettled(usable.map((p) => p.search(query, options)));
    const hits: DocumentRef[] = [];
    const errors: { provider: string; error: string }[] = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') hits.push(...r.value);
      else errors.push({ provider: usable[i]!.id, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
    });
    return { hits, errors };
  }

  async read(rawUrl: string): Promise<SourceDocument> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException('url must be an http(s) URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BadRequestException('url must be an http(s) URL');
    const provider = this.providers.find((p) => p.hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`)));
    if (!provider) {
      throw new BadRequestException(`No document provider reads ${url.hostname}. Providers: ${this.providers.map((p) => `${p.id} (${p.hosts.join(', ')})`).join('; ')}. For news outlets use fetch_source.`);
    }
    if (!provider.configured()) throw new BadRequestException(`${provider.id} is not configured for this stage`);
    if (!provider.handles(url)) throw new BadRequestException(`${provider.name} link not recognised: ${url.pathname}`);
    return provider.read(url);
  }

  private byId(id: string): DocumentProvider {
    const found = this.providers.find((p) => p.id === id);
    if (!found) throw new NotFoundException(`No document provider "${id}". Known: ${this.providers.map((p) => p.id).join(', ')}`);
    return found;
  }
}
