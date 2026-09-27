import { Module } from '@nestjs/common';
import { DYNAMO_DOC_CLIENT } from '@bubltec/mycota-dynamo';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EditorSession } from '../auth/editor-session.js';
import { contentTableName } from '../env.js';
import { ContentService } from './content.service.js';
import { CONTENT_STORE } from './content.tokens.js';
import { DynamoContentStore } from './dynamo-content.store.js';
import { EditorController } from './editor.controller.js';
import { PublicController } from './public.controller.js';

@Module({
  controllers: [PublicController, EditorController],
  providers: [
    {
      provide: CONTENT_STORE,
      inject: [DYNAMO_DOC_CLIENT],
      useFactory: (db: DynamoDBDocumentClient) => new DynamoContentStore(db, contentTableName()),
    },
    ContentService,
    EditorSession,
  ],
  exports: [ContentService],
})
export class ContentModule {}
