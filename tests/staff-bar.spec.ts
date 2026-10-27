/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The staff bar in a real browser. The publisher's back office
 * stores the address of its lookup by code for the passport's
 * origin while one of its staff is signed in; the passport then
 * draws a band under its header linking there, and nothing for
 * anyone else. Its geometry is checked here because only here
 * does the stylesheet apply: the band must leave the header and
 * the verification chip uncovered on a desktop and on a phone.
 */
import { test, expect } from '@playwright/test'

type Page = import('@playwright/test').Page

const KEY = 'transpareo:passport-admin'

async function boot(page: Page, stored?: string): Promise<void> {
  if (stored !== undefined) {
    await page.addInitScript(([key, value]) => {
      window.localStorage.setItem(key, value)
    }, [KEY, stored])
  }
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.dpp-hero')
  })
}

function shadow(page: Page, selector: string) {
  return page.locator('transpareo-time-machine').locator(selector)
}

function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const tm = document.querySelector('transpareo-time-machine') as
      HTMLElement & { state: { code: string } | null }
    return tm.state?.code ?? ''
  })
}

// Top and bottom of the band, the header and the chip, so the
// test can say none of them overlap.
function boxes(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const box = (selector: string) => {
      const node = root.querySelector(selector)
      if (!node) return null
      const r = node.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
    }
    return {
      bar: box('.staff-bar'),
      header: box('.brandbar'),
      chip: box('dpp-verification-chip'),
      card: box('.card'),
      page: document.documentElement.clientWidth
    }
  })
}

test('draws nothing for a reader without the store', async ({ page }) => {
  await boot(page)
  await expect(shadow(page, '.staff-bar')).toHaveCount(0)
})

test('links staff to the passport in the back office', async ({ page }) => {
  await boot(page, '/admin/dpps/resolve')
  const bar = shadow(page, '.staff-bar')

  await expect(bar).toHaveText('Open in application manager')
  const href = await bar.getAttribute('href')
  const lookup = 'http://localhost:5173/admin/dpps/resolve'
  expect(href).toBe(`${lookup}?code=${await code(page)}`)
})

test('never links away from the passport origin', async ({ page }) => {
  await boot(page, 'https://elsewhere.example/admin')
  await expect(shadow(page, '.staff-bar')).toHaveCount(0)
})

test('speaks the language the passport is read in', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('tm.locale', 'de')
  })
  await boot(page, '/admin/dpps/resolve')

  await expect(shadow(page, '.staff-bar'))
    .toHaveText('Im Applikations-Manager öffnen')
})

for (const width of [1280, 390]) {
  test(`leaves header and chip uncovered at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await boot(page, '/admin/dpps/resolve')
    await expect(shadow(page, '.staff-bar')).toBeVisible()
    const b = await boxes(page)

    expect(b.bar!.top).toBeGreaterThanOrEqual(b.header!.bottom)
    expect(b.bar!.top).toBeGreaterThanOrEqual(b.chip!.bottom)

    // Edge to edge across the card, inside its 1px border.
    expect(b.bar!.left - b.card!.left).toBeLessThanOrEqual(1)
    expect(b.card!.right - b.bar!.right).toBeLessThanOrEqual(1)
    expect(b.bar!.right).toBeLessThanOrEqual(b.page)

    // As tall as the walk-up band, a comfortable tap target.
    expect(b.bar!.bottom - b.bar!.top).toBeGreaterThanOrEqual(44)
  })
}
