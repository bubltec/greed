import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '@bubltec/mycota-auth';
import { type Editor, EditorGuard, editorName } from '../auth/editor.guard.js';
import { ContentService } from './content.service.js';
import { SetStatusDto } from './content.dto.js';

/**
 * Editor endpoints that span entity types. Per-entity create/update/delete/publish
 * are generated from the entity specs (see crud.controller.ts).
 */
@Controller()
@UseGuards(EditorGuard)
export class EditorController {
  constructor(private readonly content: ContentService) {}

  /** The review queue: every draft, newest first. */
  @Get('drafts')
  async drafts() {
    return (await this.content.index(true)).drafts();
  }

  @Post('status')
  setStatus(@Body() body: SetStatusDto, @CurrentUser() user: Editor) {
    return this.content.setStatus(body, editorName(user));
  }
}
