import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

// Same two-step build as btfp: tsc first so Nest's decorator metadata
// (design:paramtypes) comes from real type-checking, then esbuild bundles the
// compiled JS into one self-contained file for the Lambda image.
rmSync('.tsc-out', { recursive: true, force: true });
execSync('npx tsc -p tsconfig.json --outDir .tsc-out', { stdio: 'inherit' });

await build({
  entryPoints: ['.tsc-out/lambda.js'],
  outfile: 'dist/lambda.js',
  bundle: true,
  platform: 'node',
  target: 'node26',
  format: 'cjs',
  external: [
    '@nestjs/microservices',
    '@nestjs/websockets',
    '@nestjs/platform-express',
    '@fastify/static',
    '@fastify/view',
    'class-transformer/storage',
  ],
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': '__importMetaUrl' },
  sourcemap: true,
  minify: true,
  keepNames: true,
  logLevel: 'info',
});

rmSync('.tsc-out', { recursive: true, force: true });
