/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A lot passport in a real browser: the Volturra passport
 * with its current snapshot rewritten in flight to cover a
 * lot, and the page rewritten the way the HTML shell answers
 * a unit link in place. Rewriting the snapshot breaks its
 * proof; the card renders anyway, and the chip reports the
 * signature separately.
 */
import { test, expect } from '@playwright/test'

type Page = import('@playwright/test').Page

async function bootLot(page: Page, attrs = ''): Promise<void> {
  await page.route('http://localhost:5173/', async (route) => {
    const res = await route.fetch()
    const html = (await res.text())
      .replaceAll('nordic-wear-tshirt', 'volturra-pulse-2000')
      .replaceAll('demo-2026-t001', 'demo-2026-b001')
      .replace(/<transpareo-time-machine(?=\s+src=)/, `$& ${attrs}`)
    await route.fulfill({ response: res, body: html })
  })
  await page.route('**/v/4.json*', async (route) => {
    const res = await route.fetch()
    const doc = await res.json() as { credentialSubject: object }
    Object.assign(doc.credentialSubject, {
      passportLevel: 'lot',
      unitPassportLevel: 'item',
      lotManufacturedOn: '2026-03-01',
    })
    await route.fulfill({ response: res, json: doc })
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.unit-passports')
  })
}

// The rewritten snapshot misses the manifest's hash, so the
// verdict reads it again past the HTTP cache, and that read
// can land as a test ends, when the closing context drops the
// body it fetched. Both routes are hit while the test runs,
// so a broken handler fails it there; only reads still in
// flight at the end are let go.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

function shadow(page: Page, selector: string) {
  return page.locator('transpareo-time-machine').locator(selector)
}

test('a lot passport says its units have their own', async ({ page }) => {
  await bootLot(page)

  await expect(shadow(page, '.unit-passports'))
    .toHaveText('Each unit has its own item passport.')
})

test('says what a unit link was answered with', async ({ page }) => {
  await bootLot(page, 'requested-level="item" requested-id="SN-7"')

  await expect(shadow(page, '.walkup')).toHaveText(
    'No item passport exists for SN-7. This lot passport covers it.',
  )
})

test('shows no walk-up on an ordinary visit', async ({ page }) => {
  await bootLot(page)
  await expect(shadow(page, '.walkup')).toHaveCount(0)
})

test('dates the lot in a tile after the others', async ({ page }) => {
  await bootLot(page)
  const tile = shadow(page, '.dpp-metrics > .dpp-metric').last()

  await expect(tile.locator('.dpp-metric-label'))
    .toHaveText('Manufactured on')
  await expect(tile.locator('.dpp-metric-label svg.icon-calendar'))
    .toHaveCount(1)
  await expect(tile.locator('.dpp-metric-value')).toHaveText('March 1, 2026')
  const rows = shadow(page, '.dpp-property-row')
  await expect(rows.filter({ hasText: 'Manufactured on' })).toHaveCount(0)
})
