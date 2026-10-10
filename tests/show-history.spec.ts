/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The `?show=` gate across back and forward in a real browser,
 * through both deliveries: the lib entry (the dev page) and the
 * single-file embed. The Nordic passport's current snapshot is
 * rewritten in flight to carry one on-demand row; that breaks
 * its proof, and the row renders anyway.
 */
import { test, expect } from '@playwright/test'

type Page = import('@playwright/test').Page

const DEV = 'http://localhost:5173'
const EMBED_URL = 'http://localhost:5175/'
const PASSPORT = 'nordic-wear-tshirt/dpp/demo-2026-t001'

const ROW = {
  propertyID: 'battery:capacity',
  name: [{ '@value': 'Rated capacity', '@language': 'en' }],
  value: '42 Wh',
  access: 'onDemand'
}

// The embed host page names no passport: point its element
// at the Nordic manifest, and answer the passport's files from
// the dev server so they stay on the embed page's origin.
async function routeEmbed(page: Page): Promise<void> {
  await page.route(EMBED_URL, async (route) => {
    const res = await route.fetch()
    const src = `src="/${PASSPORT}/manifest.json"`
    const body = (await res.text())
      .replace(/<transpareo-time-machine(?=>)/, `$& ${src}`)
    await route.fulfill({ response: res, body })
  })
  await page.route(`${EMBED_URL}${PASSPORT}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname
    const res = await route.fetch({ url: DEV + path })
    await route.fulfill({ response: res })
  })
}

// Routes added last are tried first, so the snapshot route
// goes in after the embed's and fetches from the dev server
// itself.
async function boot(page: Page, url: string): Promise<void> {
  if (url === EMBED_URL) await routeEmbed(page)
  await page.route('**/v/6.json*', async (route) => {
    const path = new URL(route.request().url()).pathname
    const res = await route.fetch({ url: DEV + path })
    const doc = await res.json() as { product: { properties: object[] } }
    doc.product.properties.push(ROW)
    await route.fulfill({ response: res, json: doc })
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('dpp-properties')
  })
}

// Image and library reads may still be in flight when a test
// ends; their handlers must not fail it.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

function properties(page: Page) {
  return page.locator('transpareo-time-machine').locator('dpp-properties')
}

for (const [entry, url] of [['lib', '/'], ['embed', EMBED_URL]]) {
  test(`a forward step onto ?show= unlocks the row (${entry})`, async ({
    page
  }) => {
    await boot(page, url)
    await expect(properties(page)).not.toContainText('Rated capacity')

    // A pushState fires no popstate, so the row stays hidden
    // until the history steps back and forward onto it.
    await page.evaluate(() => history.pushState(null, '', '?show=battery'))
    await page.evaluate(() => history.back())
    await page.waitForFunction(() => location.search === '')
    await expect(properties(page)).not.toContainText('Rated capacity')

    await page.evaluate(() => history.forward())
    await page.waitForFunction(() => location.search === '?show=battery')
    await expect(properties(page)).toContainText('Rated capacity')
  })
}
