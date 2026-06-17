/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Playwright config. Used only by the a11y test
 * (tests/a11y.spec.ts); the rest of the suite runs
 * under vitest. The webServer block boots `npm run
 * dev` on demand so the test works against a freshly
 * cloned tree.
 */
import { defineConfig, devices } from '@playwright/test'

// Local developers usually have a system Chromium
// (Linux: /usr/bin/chromium, macOS: Chrome app) instead
// of Playwright's bundled browsers. CI runs `npx
// playwright install --with-deps chromium` and uses the
// bundled binary. Honour PLAYWRIGHT_CHROMIUM_PATH for
// local overrides; default to /usr/bin/chromium where
// it exists, otherwise let Playwright pick its bundled
// binary.
const localChromium = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ?? (process.env.CI ? undefined : '/usr/bin/chromium')

export default defineConfig({
  testDir: './tests',
  testMatch: /(a11y|embed-smoke|icons|snapshot)\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['Desktop Chrome'],
    launchOptions: localChromium ? { executablePath: localChromium } : {},
  },
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // The embed smoke test loads the built single-file
      // bundle, so build it, then serve dist-embed on its
      // own port.
      command: 'npm run build:embed && npm run serve:embed',
      url: 'http://localhost:5175',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
