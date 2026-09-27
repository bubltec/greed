import { Controller, Get, Header, NotFoundException, Param, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ContentIndex } from '@greed/domain';
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

  @Get('topics/:id')
  async topic(@Req() req: FastifyRequest, @Param('id') id: string, @Query('preview') preview?: string) {
    const view = (await this.visible(req, preview)).view(id);
    if (!view) throw new NotFoundException(`No topic "${id}"`);
    return view;
  }

  @Get('graph')
  async graph(@Req() req: FastifyRequest, @Query('preview') preview?: string) {
    return (await this.visible(req, preview)).graph();
  }

  @Get('activity')
  async activity(@Req() req: FastifyRequest, @Query('preview') preview?: string) {
    return (await this.visible(req, preview)).activity(30);
  }

  /** The whole dataset as JSON: published content for everyone, everything for editors in preview. */
  @Get('export')
  @Header('Content-Disposition', 'attachment; filename="greed-export.json"')
  async export(@Req() req: FastifyRequest, @Query('preview') preview?: string) {
    const { snapshot } = await this.visible(req, preview);
    return { exportedAt: new Date().toISOString(), ...snapshot };
  }
}
