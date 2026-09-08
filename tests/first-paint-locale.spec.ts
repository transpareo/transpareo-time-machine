/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A German visitor's first paint is German. The label chunk
 * for the picked locale is held back on the wire while the
 * manifest lands; the page must keep its boot shell up rather
 * than mount in the English fallback, and mount in German the
 * moment the chunk arrives.
 */
import { test, expect } from '@playwright/test'

test.use({ locale: 'de-DE' })

test('the page waits for the German labels', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route('**/i18n/data/de.json*', async (route) => {
    await held
    await route.continue()
  })

  const manifest = page.waitForResponse((res) => (
    res.url().endsWith('/manifest.json')
  ))

  // Not `load`: the held chunk is a module request, and
  // Firefox keeps the load event back until it settles.
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await manifest

  // Data is in, labels are not: the shell must still be up.
  await page.waitForTimeout(300)
  const shell = page.locator('transpareo-time-machine .boot-shell')
  await expect(shell).toHaveCount(1)
  await expect(page.locator('transpareo-time-machine .stage'))
    .toHaveCount(0)

  release()
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.stage')
  })

  // The tree that mounted is German from its first frame.
  const label = page.locator('transpareo-time-machine .locale-label')
  await expect(label).toHaveText('Deutsch')
})
