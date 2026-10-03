import { configDefaults, defineConfig } from 'vitest/config';
import { coverage } from '../../vitest.shared.js';

// Build output (.tsc-out during the Lambda bundle, dist-dev during `dev`) must
// not be collected as tests; same reasoning as btfp.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/.tsc-out/**', '**/dist*/**'],
    coverage: coverage(['src/**/*.ts'], [
      'src/main.ts', // starts the HTTP server
      'src/lambda.ts', // Lambda handler: fetches SSM secrets, needs AWS
      'src/local-tables.ts', // creates tables in the local DynamoDB container
    ]),
  },
});
