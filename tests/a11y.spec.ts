/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Automated WCAG 2.2 AA check via axe-core. Loads the
 * dev demo page (nordic-wear-tshirt), waits for the
 * SPA to finish mounting, and asserts no AA violations
 * from the rules the SPA itself can enforce.
 *
 * The `color-contrast` rule is disabled because every
 * pigment on the rendered page derives from per-publisher
 * branding CSS (--font-color, --action-color, --body-
 * background, etc.). Whether the chosen palette hits
 * 4.5:1 is a branding-side decision the SPA cannot
 * validate without forking each publisher's theme into
 * SPA defaults; the demo's brand colours are deliberately
 * left untouched so this test surfaces structural a11y
 * issues (labels, ARIA, focus, keyboard, landmarks)
 * without pretending to gate palette choices.
 *
 * Coverage: ~30-50% of WCAG criteria are mechanically
 * detectable; the rest (cognitive load, motion
 * sensitivity nuance, screen-reader UX) still need
 * human review on top of this gate.
 *
 * Local: run `npm run seed && npm run dev` once, then
 * `npm run a11y` in another shell.
 */
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('dev demo passes WCAG 2.2 AA (axe-core)', async ({ page }) => {
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })

  // The custom element mounts the SPA into its shadow
  // root once `host.loadState === 'ready'`. Wait for
  // the mounted stage so axe scans the rendered tree,
  // not the boot spinner.
  await page.waitForFunction(() => {
    const el = document.querySelector('transpareo-time-machine')
    return !!(el?.shadowRoot?.querySelector('.stage'))
  })

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .disableRules(['color-contrast'])
    .analyze()

  expect(results.violations, JSON.stringify(results.violations, null, 2))
    .toEqual([])
})
