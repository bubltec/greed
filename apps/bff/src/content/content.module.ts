import { Module } from '@nestjs/common';
import { DYNAMO_DOC_CLIENT } from '@bubltec/mycota-dynamo';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EditorSession } from '../auth/editor-session.js';
import { ARCHIVE, UnconfiguredArchive } from '../archive/archive.js';
import { contentTableName } from '../env.js';
import { ContentService } from './content.service.js';
import { CONTENT_STORE } from './content.tokens.js';
import { DynamoContentStore } from './dynamo-content.store.js';
import { crudController } from './crud.controller.js';
import { ENTITY_SPECS } from './entities/index.js';
import { EditorController } from './editor.controller.js';
import { HtmlController } from './html.controller.js';
import { PublicController } from './public.controller.js';

@Module({
  controllers: [PublicController, HtmlController, EditorController, ...ENTITY_SPECS.map(crudController)],
  providers: [
    {
      provide: CONTENT_STORE,
      inject: [DYNAMO_DOC_CLIENT],
      useFactory: (db: DynamoDBDocumentClient) => new DynamoContentStore(db, contentTableName()),
    },
    // No storage is wired in yet: a stage reports the archive as unconfigured until an S3 adapter replaces this.
    { provide: ARCHIVE, useValue: new UnconfiguredArchive() },
    ContentService,
    EditorSession,
  ],
  exports: [ContentService, ARCHIVE],
})
export class ContentModule {}
