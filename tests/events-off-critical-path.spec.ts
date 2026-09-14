/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The events feed is fetched beside the first paint, not
 * before it. On the live demo that request took most of a
 * second, and the card - the thing the visitor scanned the
 * code for - waited behind it for a timeline that is below
 * the fold and closed on arrival.
 *
 * The trade this pins down is the one that would make the
 * change not worth having: a card that renders sooner and
 * then jumps when the feed lands. The timeline holds its
 * collapsed strip's space from the first paint, so the
 * card's position is the same before and after.
 */
import { test, expect } from '@playwright/test'

type Page = import('@playwright/test').Page

// Hold the feed open so the page can be read mid-boot.
async function holdFeed(page: Page) {
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route('**/epcis.json*', async (route) => {
    await held
    await route.continue()
  })
  return release
}

function layout(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    const card = root?.querySelector('.card') as HTMLElement | null
    const timeline = root?.querySelector('dpp-timeline') as HTMLElement | null
    return {
      card: !!card,
      cardTop: card?.getBoundingClientRect().top ?? null,
      timelineDisplay: timeline ? getComputedStyle(timeline).display : null,
      dots: root?.querySelectorAll('.event').length ?? 0
    }
  })
}

test('the card renders while the feed is still coming', async ({ page }) => {
  const release = await holdFeed(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.card')
  })

  const during = await layout(page)
  expect(during.card).toBe(true)

  // No events yet, and the strip is holding its space
  // rather than waiting to appear under the card.
  expect(during.dots).toBe(0)
  expect(during.timelineDisplay).not.toBe('none')

  release()
})

test('the card does not move when the feed lands', async ({ page }) => {
  const release = await holdFeed(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.card')
  })

  const before = await layout(page)
  release()

  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return (root?.querySelectorAll('.event').length ?? 0) > 0
  })
  const after = await layout(page)

  expect(after.dots).toBeGreaterThan(0)
  expect(after.cardTop).toBe(before.cardTop)
})
