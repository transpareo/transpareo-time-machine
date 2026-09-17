/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Turning a page in the fullscreen viewer. The browser
 * keeps painting the picture being left until the new bytes
 * decode, and the viewer warms nothing ahead, so every turn
 * is a cold full-size request that leaves the old picture
 * sitting there. The turn has to say it registered and that
 * the next picture is coming.
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

interface Turned {
  current: string | null
  loading: boolean
  spinners: number
  imageOpacity: string
}

async function openLightbox(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    const img = root?.querySelector<HTMLImageElement>('.gallery-image')
    return !!img?.complete
  })
  await page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    root.querySelector<HTMLImageElement>('.gallery-image')!.click()
  })
  await page.waitForSelector('dpp-lightbox.open', { state: 'attached' })
}

// Click a numbered page and read the viewer back without
// yielding, so what the assertion sees is the state the
// click itself left behind.
function turnTo(page: Page, want: string): Promise<Turned> {
  return page.evaluate((wanted) => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const lb = root.querySelector('dpp-lightbox')!
    const img = lb.querySelector('.gallery-image')!
    const btn = [...lb.querySelectorAll<HTMLElement>('[data-page]')]
      .find((b) => b.dataset.page === wanted)!

    btn.click()
    return {
      current: lb.querySelector('.btn.current')?.textContent ?? null,
      loading: lb.classList.contains('loading'),
      spinners: lb.querySelectorAll('svg.icon-spinner').length,
      imageOpacity: getComputedStyle(img).opacity
    }
  }, want)
}

function loading(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const lb = root.querySelector('dpp-lightbox')!
    return lb.classList.contains('loading')
  })
}

test('a click turns the pagination in its own frame', async ({ page }) => {
  await openLightbox(page)
  expect((await turnTo(page, '3')).current).toBe('3')
})

test('a turn to a cold picture says it is coming', async ({ page }) => {
  await openLightbox(page)

  const turned = await turnTo(page, '3')
  expect(turned.loading).toBe(true)
  expect(turned.spinners).toBe(1)

  // The picture being left steps back in the same frame as
  // the click, so the turn shows before the bytes do.
  expect(Number(turned.imageOpacity)).toBeLessThan(1)

  // And it stops saying so once the picture is there.
  await expect.poll(() => loading(page)).toBe(false)
})

test('closing mid-load drops the pending mark', async ({ page }) => {
  await openLightbox(page)
  expect((await turnTo(page, '3')).loading).toBe(true)

  const afterClose = await page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const lb = root.querySelector('dpp-lightbox')!
    lb.querySelector<HTMLElement>('.close')!.click()
    return {
      open: lb.classList.contains('open'),
      loading: lb.classList.contains('loading')
    }
  })

  expect(afterClose.open).toBe(false)
  expect(afterClose.loading).toBe(false)
})
