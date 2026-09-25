import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/__tests__/**/*.test.ts', 'packages/**/__tests__/**/*.test.ts'],
    environment: 'node',
    // Each test file gets an isolated HIVE_HOME (see test-utils/hive-home.ts).
    pool: 'forks',
    testTimeout: 20000,
  },
});
