import { Controller, Get, Header, Inject, NotFoundException, Param, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { browseActivity, browseTopics, type ContentIndex, isPageId, parseActivityQuery, parseBrowseQuery } from '@greed/domain';
import { ARCHIVE, type Archive, archiveKey } from '../archive/archive.js';
import { EditorSession } from '../auth/editor-session.js';
import { ContentService } from './content.service.js';

/**
 * Unauthenticated reads, published content only. `?preview=1` from a signed-in
 * editor includes drafts (and skips the cache); for anyone else it is ignored.
 */
@Controller()
export class PublicController {
  constructor(
    private readonly content: ContentService,
    private readonly session: EditorSession,
    @Inject(ARCHIVE) private readonly archive: Archive,
  ) {}

  private async visible(request: FastifyRequest, preview?: string): Promise<ContentIndex> {
    if (preview === '1' && (await this.session.isEditor(request))) return this.content.index(true);
    return (await this.content.index()).published();
  }

  @Get('health')
  health() {
    return { ok: true };
  }

  @Get('topics')
  async topics(@Req() req: FastifyRequest, @Query('preview') preview?: string) {
    return (await this.visible(req, preview)).summaries();
  }

  /**
   * The home list, searched, filtered, sorted and paged on the server so a reader only downloads one page.
   * Query: q, kind, sort, dir, page, size. Unreadable values fall back to the defaults.
   */
  @Get('browse')
  async browse(@Req() req: FastifyRequest, @Query() query: Record<string, string>) {
    return browseTopics((await this.visible(req, query.preview)).summaries(), parseBrowseQuery(query));
  }

  @Get('topics/:id')
  async topic(@Req() req: FastifyRequest, @Param('id') id: string, @Query('preview') preview?: string) {
    const view = (await this.visible(req, preview)).view(id);
    if (!view) throw new NotFoundException(`No topic "${id}"`);
    return view;
  }

  /**
   * An archived file, published attachments only (an editor's `?preview=1` also sees drafts). The type comes
   * from the archive, which only ever stored an allowlisted one, and the response cannot be sniffed or scripted.
   */
  @Get('attachments/:id/file')
  async attachmentFile(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('id') id: string,
    @Query('preview') preview?: string,
  ) {
    const attachment = ((await this.visible(req, preview)).snapshot.attachments ?? []).find((a) => a.id === id);
    const file = attachment && (await this.archive.get(archiveKey(attachment.sha256)));
    if (!attachment || !file) throw new NotFoundException(`No attachment "${id}"`);
    reply.header('content-type', file.mimeType);
    reply.header('content-disposition', 'inline');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('content-security-policy', "default-src 'none'; sandbox");
    reply.header('cache-control', preview === '1' ? 'private, no-store' : 'public, max-age=300');
    return Buffer.from(file.bytes);
  }

  @Get('graph')
  async graph(@Req() req: FastifyRequest, @Query('preview') preview?: string) {
    return (await this.visible(req, preview)).graph();
  }

  @Get('activity')
  async activity(@Req() req: FastifyRequest, @Query() query: Record<string, string>) {
    return browseActivity((await this.visible(req, query.preview)).allActivity(), parseActivityQuery(query));
  }

  @Get('pages/:id')
  async page(@Req() req: FastifyRequest, @Param('id') id: string, @Query('preview') preview?: string) {
    if (!isPageId(id)) throw new NotFoundException(`No page "${id}"`);
    const editor = preview === '1' && (await this.session.isEditor(req));
    return this.content.page(id, editor);
  }

  /** The whole dataset as JSON: published content for everyone, everything for editors in preview. */
  @Get('export')
  @Header('Content-Disposition', 'attachment; filename="greed-export.json"')
  async export(@Req() req: FastifyRequest, @Query('preview') preview?: string) {
    const { snapshot } = await this.visible(req, preview);
    return { exportedAt: new Date().toISOString(), ...snapshot };
  }
}
