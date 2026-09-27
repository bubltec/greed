import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module.js';
import { OAuthModule } from '../oauth/oauth.module.js';
import { McpController } from './mcp.controller.js';
import { McpService } from './mcp.service.js';

@Module({
  imports: [ContentModule, OAuthModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
