import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { createApp } from './app.js';
import { ensureLocalTables } from './local-tables.js';

async function bootstrap() {
  // Local dev reads the repo-root .env (see .env.example).
  const envPath = resolve(fileURLToPath(new URL('../../../.env', import.meta.url)));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  process.env.DYNAMODB_ENDPOINT ??= 'http://127.0.0.1:8000';
  await ensureLocalTables();
  const app = await createApp(new FastifyAdapter());
  const port = process.env.PORT ? Number(process.env.PORT) : 3002;
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`greed BFF listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
