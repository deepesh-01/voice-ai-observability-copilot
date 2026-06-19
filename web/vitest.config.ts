import { defineConfig } from 'vitest/config';

/**
 * Unit tests only (pure logic in src/*.test.ts). The Playwright E2E specs live in
 * e2e/*.spec.ts and are run separately via `npm run test:e2e` — exclude them here so
 * vitest doesn't try to load @playwright/test.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
