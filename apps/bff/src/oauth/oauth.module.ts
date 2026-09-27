import { Module } from '@nestjs/common';
import { DYNAMO_DOC_CLIENT } from '@bubltec/mycota-dynamo';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { authTableName } from '../env.js';
import { OAuthController } from './oauth.controller.js';
import { OAuthService } from './oauth.service.js';
import { DynamoOAuthStore, OAUTH_STORE } from './oauth.store.js';

@Module({
  controllers: [OAuthController],
  providers: [
    {
      provide: OAUTH_STORE,
      inject: [DYNAMO_DOC_CLIENT],
      useFactory: (db: DynamoDBDocumentClient) => new DynamoOAuthStore(db, authTableName()),
    },
    OAuthService,
  ],
  exports: [OAuthService],
})
export class OAuthModule {}
