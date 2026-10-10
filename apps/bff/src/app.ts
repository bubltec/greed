import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { AppModule } from './app.module.js';
import { corsOrigin, isProduction } from './env.js';
import { registerOAuthReturnHook, registerWellKnown } from './oauth/well-known.js';
import { isPublicCacheable, PUBLIC_CACHE_CONTROL } from './public-cache.js';
import { VALIDATION_PIPE_OPTIONS } from './validation.js';

export async function createApp(adapter: FastifyAdapter): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: isProduction() ? ['error', 'warn'] : ['error', 'warn', 'log'],
  });
  return configureApp(app);
}

/** Everything createApp does after construction; tests call this on their own module. */
export async function configureApp(app: NestFastifyApplication): Promise<NestFastifyApplication> {
  const fastify = app.getHttpAdapter().getInstance();
  // Before the cookie plugin, so its onSend hook serialises the cookie this one clears.
  registerOAuthReturnHook(fastify);
  await app.register(fastifyCookie);
  registerWellKnown(fastify);

  // Passport's OAuth redirect calls res.setHeader()/res.end(), which Fastify's
  // reply lacks; delegate to the raw response (nestjs/nest#5702, same as btfp).
  fastify.addHook('onRequest', (_request, reply, done) => {
    const patchable = reply as unknown as {
      setHeader: typeof reply.raw.setHeader;
      end: typeof reply.raw.end;
    };
    patchable.setHeader = reply.raw.setHeader.bind(reply.raw);
    patchable.end = reply.raw.end.bind(reply.raw);
    done();
  });

  // Public reads are cached at CloudFront (infra/cdk web-stack.ts). CloudFront only honors
  // stale-while-revalidate / stale-if-error from the origin's own Cache-Control, so set it here,
  // on successful public GETs only; errors, editor previews and everything else stay uncached.
  fastify.addHook('onSend', (request, reply, payload, done) => {
    if (isPublicCacheable(request.method, request.url, reply.statusCode)) {
      reply.header('cache-control', PUBLIC_CACHE_CONTROL);
    }
    done(null, payload);
  });

  app.enableCors({ origin: corsOrigin(), credentials: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe(VALIDATION_PIPE_OPTIONS));
  return app;
}
