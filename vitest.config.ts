import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Standalone Vitest config so the test run doesn't pull
// in vite.config.ts's lib-mode build options and icon-
// sprite plugin. The only shared concern is the `@/`
// path alias.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],

    // These are Playwright specs (browser tests driven by
    // @playwright/test); they run under Playwright
    // (`npm run a11y`), not vitest, and throw on import here
    // because @playwright/test's test() needs the Playwright
    // runner.
    exclude: [
      'tests/a11y.spec.ts',
      'tests/embed-smoke.spec.ts',
      'tests/icons.spec.ts',
      'tests/snapshot.spec.ts',
      'node_modules/**',
    ],
    environment: 'node',
    globals: false,
  },
});
