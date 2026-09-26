import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ContentService } from './content.service.js';

/** Unauthenticated reads. `?fresh=1` skips the cache (the CMS uses it after a save). */
@Controller()
export class PublicController {
  constructor(private readonly content: ContentService) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  @Get('topics')
  async topics(@Query('fresh') fresh?: string) {
    return (await this.content.index(fresh === '1')).summaries();
  }

  @Get('topics/:id')
  topic(@Param('id') id: string, @Query('fresh') fresh?: string) {
    return this.content.view(id, fresh === '1');
  }

  @Get('graph')
  async graph() {
    return (await this.content.index()).graph();
  }

  @Get('activity')
  async activity() {
    return (await this.content.index()).activity(30);
  }

  /** The whole dataset as JSON: a backup, and an open-data download. */
  @Get('export')
  @Header('Content-Disposition', 'attachment; filename="greed-export.json"')
  async export() {
    const { snapshot } = await this.content.index(true);
    return { exportedAt: new Date().toISOString(), ...snapshot };
  }
}
