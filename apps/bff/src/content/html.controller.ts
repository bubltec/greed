import { Controller, Get, OnModuleInit, Req, Res } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { llmsTxt, pageDocument, sitemapXml } from '@greed/domain';
import { publicOrigin } from '../env.js';
import { ContentService } from './content.service.js';
import { renderHtml, webAssets } from './html-document.js';

/**
 * The HTML (and the model/sitemap indexes) for a public URL. CloudFront asks
 * for these instead of the empty SPA shell, so the first response already
 * contains that page. Drafts are never included.
 */
@Controller()
export class HtmlController implements OnModuleInit {
  constructor(
    private readonly content: ContentService,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  /**
   * Nested paths (`/api/html/t/:id`) go on Fastify itself. Nest's named
   * wildcard is not a pattern find-my-way will match.
   */
  onModuleInit() {
    const fastify = this.adapterHost.httpAdapter.getInstance() as FastifyInstance;
    fastify.get('/api/html/*', (req, reply) => this.document(req, reply));
  }

  @Get('html')
  async document(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const request = requestPath(req.url);
    const doc = pageDocument(request.path, (await this.content.index()).published());
    if (request.preview) doc.robots = 'noindex, nofollow';
    reply.status(doc.status).type('text/html; charset=utf-8');
    return renderHtml(doc, publicOrigin(), webAssets());
  }

  @Get('llms.txt')
  async llms(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.type('text/plain; charset=utf-8');
    return llmsTxt((await this.content.index()).published(), publicOrigin());
  }

  @Get('sitemap.xml')
  async sitemap(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.type('application/xml; charset=utf-8');
    return sitemapXml((await this.content.index()).published(), publicOrigin());
  }

  @Get('robots.txt')
  robots(@Res({ passthrough: true }) reply: FastifyReply) {
    const origin = publicOrigin();
    reply.type('text/plain; charset=utf-8');
    return `User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${origin}/sitemap.xml\n`;
  }
}

function requestPath(url: string): { path: string; preview: boolean } {
  const [pathname = '/', query = ''] = url.split('?');
  const stripped = pathname.replace(/^\/api\/html/, '') || '/';
  return { path: stripped.startsWith('/') ? stripped : `/${stripped}`, preview: new URLSearchParams(query).has('preview') };
}
