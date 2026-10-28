/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The public `openModal` method. An integration's modal wears
 * the chrome of the SPA's own modals: full screen on a phone,
 * the same overlay and a centred card on a wide screen.
 *
 * Runs against `npm run dev`.
 */
import { test, expect, type Page } from '@playwright/test'

async function openGeneric(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => {
    const tm = document.querySelector('transpareo-time-machine')
    return tm?.shadowRoot?.querySelector('dpp-modal') != null
  })
  await page.evaluate(() => {
    const tm = document.querySelector('transpareo-time-machine')!
    tm.openModal({ title: 'Integration', body: 'Body text' })
  })
  await expect(page.locator('dpp-modal .modal-title'))
    .toHaveText('Integration')
}

test('fills the screen on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openGeneric(page)

  const box = await page.locator('dpp-modal .modal').boundingBox()
  expect(box!.x).toBe(0)
  expect(box!.y).toBe(0)
  expect(box!.width).toBe(390)

  // WebKit resolves 100vh as 8.44 times 100 in single precision
  // and truncates it to its 1/64 px layout grid: 843.984375.
  expect(box!.height).toBeGreaterThan(844 - 0.5)
  await expect(page.locator('dpp-modal .modal-close')).toBeVisible()
})

test('shares the overlay of the SPA modals on a wide screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openGeneric(page)

  const styles = await page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!
      .shadowRoot!
    const read = (tag: string): string[] => {
      const host = root.querySelector(tag)!
      host.classList.add('open')
      const s = getComputedStyle(host)
      return [
        s.paddingTop, s.paddingLeft, s.backgroundColor,
        s.backdropFilter, s.zIndex, s.alignItems
      ]
    }
    return { generic: read('dpp-modal'), event: read('dpp-event-modal') }
  })
  expect(styles.generic).toEqual(styles.event)

  const box = await page.locator('dpp-modal .modal').boundingBox()
  expect(box!.width).toBe(640)
  expect(box!.x).toBe((1280 - 640) / 2)
})
