import { configDefaults, defineConfig } from 'vitest/config';

// Build output (.tsc-out during the Lambda bundle, dist-dev during `dev`) must
// not be collected as tests; same reasoning as btfp.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '**/.tsc-out/**', '**/dist*/**'] },
});
