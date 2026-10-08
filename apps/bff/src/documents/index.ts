import { CourtListenerProvider } from './courtlistener.js';
import { DocumentProviders } from './registry.js';

/**
 * The providers live in this stage. Add a source here and it shows up in
 * search_documents / read_document with no tool changes. Credentials come
 * from env vars that lambda.ts fills from SSM at cold start.
 */
export function liveDocuments(): DocumentProviders {
  return new DocumentProviders([new CourtListenerProvider(() => process.env.COURT_LISTENER_API_KEY)]);
}

export { DocumentProviders } from './registry.js';
