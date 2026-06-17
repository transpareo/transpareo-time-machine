/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Smoke test for the single-file EMBED delivery
 * (dist-embed/embed.js). The lib/dev path (index.html and
 * the a11y test) never runs embed.ts's CSS inlining, so this
 * asserts the bundle's unique contract: loaded as one module
 * with no stylesheet link, it registers the custom element,
 * upgrades it to a shadow host, and injects app.css itself.
 *
 * Served by scripts/serve-embed.ts on port 5175 (the
 * Playwright webServer builds the bundle first).
 */
import { test, expect } from '@playwright/test'

const EMBED_URL = 'http://localhost:5175/'

test('embed bundle registers the element and inlines its CSS', async ({
  page,
}) => {
  await page.goto(EMBED_URL, { waitUntil: 'networkidle' })

  // Custom element is registered on import, no manifest
  // needed.
  await page.waitForFunction(
    () => customElements.get('transpareo-time-machine') != null,
  )

  // The element upgraded to a shadow host.
  const hasShadow = await page.evaluate(
    () => document.querySelector('transpareo-time-machine')?.shadowRoot != null,
  )
  expect(hasShadow).toBe(true)

  // app.css was inlined by the bundle: the host page ships no
  // styles, so a rule from app.css present in the document
  // proves embed.ts injected it.
  const cssInlined = await page.evaluate(
    () => Array.from(document.querySelectorAll('style'))
      .some((s) => (s.textContent ?? '').includes('color-scheme')),
  )
  expect(cssInlined).toBe(true)
})
