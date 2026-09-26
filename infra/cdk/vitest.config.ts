import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '**/cdk.out/**'], testTimeout: 60_000 },
});
