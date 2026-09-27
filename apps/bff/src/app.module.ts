import { Module } from '@nestjs/common';
import { MycotaAuthModule } from '@bubltec/mycota-auth';
import { DynamoModule } from '@bubltec/mycota-dynamo';
import { SessionController } from './auth/session.controller.js';
import { ContentModule } from './content/content.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { OAuthModule } from './oauth/oauth.module.js';
import { buildMycotaAuthConfig } from './mycota-config.js';

@Module({
  imports: [
    DynamoModule,
    MycotaAuthModule.forRootAsync({ useFactory: buildMycotaAuthConfig }),
    ContentModule,
    OAuthModule,
    McpModule,
  ],
  controllers: [SessionController],
})
export class AppModule {}
