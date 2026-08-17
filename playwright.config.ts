/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Playwright config. Drives the browser suite (the specs
 * named in testMatch below, the WCAG gate among them); the
 * rest of the tests run under vitest. The webServer block
 * boots `npm run dev` on demand so the suite works against
 * a freshly cloned tree.
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
  testMatch:
    /(a11y|embed-smoke|icons|integration-hook|locale-picker|snapshot|verifier-theme)\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
  },

  // Both browsers gate a release. Chromium is what
  // `npm run browser` runs; WebKit is Safari's engine, as
  // likely as anything to be what a phone scanning a DPP
  // code runs, and `npm run browser:webkit` drives it. Its
  // Linux build links against libicu74 and libflite, so on a
  // distro shipping neither, `npm run browser:webkit:docker`
  // runs the same suite inside the Playwright container
  // image.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: localChromium ? { executablePath: localChromium } : {},
      },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
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
