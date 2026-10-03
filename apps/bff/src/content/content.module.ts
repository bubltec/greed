import { Module } from '@nestjs/common';
import { DYNAMO_DOC_CLIENT } from '@bubltec/mycota-dynamo';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EditorSession } from '../auth/editor-session.js';
import { contentTableName } from '../env.js';
import { ContentService } from './content.service.js';
import { CONTENT_STORE } from './content.tokens.js';
import { DynamoContentStore } from './dynamo-content.store.js';
import { crudController } from './crud.controller.js';
import { ENTITY_SPECS } from './entities/index.js';
import { EditorController } from './editor.controller.js';
import { PublicController } from './public.controller.js';

@Module({
  controllers: [PublicController, EditorController, ...ENTITY_SPECS.map(crudController)],
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
