import { configDefaults, defineConfig } from 'vitest/config';
import { coverage } from '../../vitest.shared.js';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**'],
    coverage: coverage(['src/**/*.ts'], ['src/index.ts' /* re-exports only */]),
  },
});
