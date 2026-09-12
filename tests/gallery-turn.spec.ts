/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Turning a gallery page. Swapping the image's src leaves
 * the frame empty until the new bytes arrive, so on a slow
 * link a turn used to look like the click had not
 * registered. The neighbours are fetched while the visitor
 * looks at the picture they are on, so the usual turn shows
 * its picture in the same frame as the click.
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const SHOWN = /lifestyle-a-thumbnail/
const NEIGHBOUR = /lifestyle-b-thumbnail/
const FAR = /detail-thumbnail/

async function gallery(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    const img = root?.querySelector('.gallery-image') as HTMLImageElement | null
    return !!img?.complete
  })
}

// What the browser has actually fetched, which is the only
// place a warmed neighbour shows up: it is in no attribute
// until the visitor turns to it.
function fetched(page: Page, pattern: RegExp): Promise<boolean> {
  return page.evaluate((source) => {
    const re = new RegExp(source)
    return performance.getEntriesByType('resource')
      .some((r) => re.test(r.name))
  }, pattern.source)
}

test('the next picture is fetched before it is asked for', async ({ page }) => {
  await gallery(page)
  await expect.poll(() => fetched(page, SHOWN)).toBe(true)
  await expect.poll(() => fetched(page, NEIGHBOUR)).toBe(true)

  // Two away is not a neighbour, so it waits to be asked
  // for. Warming the whole gallery would spend a visitor's
  // data on pictures most of them never open.
  expect(await fetched(page, FAR)).toBe(false)
})

test('turning to a warmed neighbour shows it at once', async ({ page }) => {
  await gallery(page)
  await expect.poll(() => fetched(page, NEIGHBOUR)).toBe(true)

  const shown = await page.evaluate(async () => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const img = root.querySelector('.gallery-image') as HTMLImageElement
    const nav = root.querySelector('.navigation')!
    const second = [...nav.querySelectorAll<HTMLElement>('[data-page]')]
      .find((b) => b.dataset.page === '2')!

    second.click()
    const asked = new URL(img.getAttribute('src')!, location.href).href

    // One frame for the paint, not a load event: decoded
    // bytes need no round trip.
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    return { complete: img.complete, matches: img.currentSrc === asked }
  })

  expect(shown.complete).toBe(true)
  expect(shown.matches).toBe(true)
})

test('a turn to a cold picture says it is coming', async ({ page }) => {
  await gallery(page)

  const marked = await page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const wrap = root.querySelector('.gallery')!
    const nav = root.querySelector('.navigation')!
    const third = [...nav.querySelectorAll<HTMLElement>('[data-page]')]
      .find((b) => b.dataset.page === '3')!

    third.click()
    return wrap.classList.contains('loading')
  })
  expect(marked).toBe(true)

  // And it stops saying so once the picture is there.
  await expect.poll(() => page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    return root.querySelector('.gallery')!.classList.contains('loading')
  })).toBe(false)
})
