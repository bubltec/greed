import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '@bubltec/mycota-auth';
import { type Editor, EditorGuard, editorName } from '../auth/editor.guard.js';
import { ContentService } from './content.service.js';
import {
  PerspectiveInputDto,
  ReferenceInputDto,
  RelationInputDto,
  SetStatusDto,
  TopicInputDto,
} from './content.dto.js';
import { IsBoolean, IsOptional } from 'class-validator';

export class PublishTopicDto {
  /** Also publish the topic's draft sources, perspectives and links (default true). */
  @IsOptional()
  @IsBoolean()
  includeChildren?: boolean;
}

/** Every write. Returns the refreshed TopicView so the CMS never re-reads a stale cache. */
@Controller()
@UseGuards(EditorGuard)
export class EditorController {
  constructor(private readonly content: ContentService) {}

  @Post('topics')
  createTopic(@Body() body: TopicInputDto, @CurrentUser() user: Editor) {
    return this.content.createTopic(body, editorName(user));
  }

  @Put('topics/:id')
  updateTopic(@Param('id') id: string, @Body() body: TopicInputDto, @CurrentUser() user: Editor) {
    return this.content.updateTopic(id, body, editorName(user));
  }

  @Delete('topics/:id')
  @HttpCode(204)
  async deleteTopic(@Param('id') id: string) {
    await this.content.deleteTopic(id);
  }

  @Post('topics/:id/references')
  addReference(
    @Param('id') id: string,
    @Body() body: ReferenceInputDto,
    @CurrentUser() user: Editor,
  ) {
    return this.content.saveReference(id, undefined, body, editorName(user));
  }

  @Put('topics/:id/references/:refId')
  updateReference(
    @Param('id') id: string,
    @Param('refId') refId: string,
    @Body() body: ReferenceInputDto,
    @CurrentUser() user: Editor,
  ) {
    return this.content.saveReference(id, refId, body, editorName(user));
  }

  @Delete('topics/:id/references/:refId')
  deleteReference(
    @Param('id') id: string,
    @Param('refId') refId: string,
    @CurrentUser() user: Editor,
  ) {
    return this.content.deleteReference(id, refId, editorName(user));
  }

  @Post('topics/:id/perspectives')
  addPerspective(
    @Param('id') id: string,
    @Body() body: PerspectiveInputDto,
    @CurrentUser() user: Editor,
  ) {
    return this.content.savePerspective(id, undefined, body, editorName(user));
  }

  @Put('topics/:id/perspectives/:pid')
  updatePerspective(
    @Param('id') id: string,
    @Param('pid') pid: string,
    @Body() body: PerspectiveInputDto,
    @CurrentUser() user: Editor,
  ) {
    return this.content.savePerspective(id, pid, body, editorName(user));
  }

  @Delete('topics/:id/perspectives/:pid')
  deletePerspective(@Param('id') id: string, @Param('pid') pid: string) {
    return this.content.deletePerspective(id, pid);
  }

  @Post('relations')
  addRelation(@Body() body: RelationInputDto, @CurrentUser() user: Editor) {
    return this.content.saveRelation(undefined, body, editorName(user));
  }

  @Put('relations/:rid')
  updateRelation(
    @Param('rid') rid: string,
    @Body() body: RelationInputDto,
    @CurrentUser() user: Editor,
  ) {
    return this.content.saveRelation(rid, body, editorName(user));
  }

  @Delete('relations/:rid')
  @HttpCode(204)
  async deleteRelation(@Param('rid') rid: string) {
    await this.content.deleteRelation(rid);
  }

  /** The review queue: every draft, newest first. */
  @Get('drafts')
  async drafts() {
    return (await this.content.index(true)).drafts();
  }

  @Post('status')
  setStatus(@Body() body: SetStatusDto, @CurrentUser() user: Editor) {
    return this.content.setStatus(body, editorName(user));
  }

  @Post('topics/:id/publish')
  publishTopic(@Param('id') id: string, @Body() body: PublishTopicDto, @CurrentUser() user: Editor) {
    return this.content.publishTopic(id, body?.includeChildren ?? true, editorName(user));
  }

}
