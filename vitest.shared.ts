import type { CoverageOptions } from 'vitest/node';

/**
 * Every package's `pnpm test` runs with coverage and fails below this, on every metric
 * including branches (the conditions). CI runs `turbo run test`, so a PR that leaves code
 * untested fails there. Raise it, never lower it; see `.cursor/rules/write-tests.mdc`.
 */
export const COVERAGE_THRESHOLD = 90;

/**
 * @param include source globs to measure, relative to the package
 * Test helpers named `*.testing.ts` are never measured.
 * @param exclude process entry points and operational scripts only: code that can't run without
 *   AWS, a database or a network. Name each one and say why next to the config that uses it.
 */
export function coverage(include: string[], exclude: string[] = []): CoverageOptions {
  return {
    provider: 'v8',
    include,
    exclude: ['**/*.spec.ts', '**/*.testing.ts', '**/*.d.ts', ...exclude],
    reporter: ['text', 'lcov'],
    thresholds: {
      statements: COVERAGE_THRESHOLD,
      branches: COVERAGE_THRESHOLD,
      functions: COVERAGE_THRESHOLD,
      lines: COVERAGE_THRESHOLD,
    },
  };
}
