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
 *
 * The events show once the feed's signature is judged, so
 * the strip holds its space through that check as well. A
 * feed that fails it, or names another passport, shows no
 * timeline at all.
 */
import { test, expect } from '@playwright/test'

type Page = import('@playwright/test').Page

// Hold the requests a pattern matches open, so the page can
// be read mid-boot.
async function hold(page: Page, pattern: string) {
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route(pattern, async (route) => {
    await held
    await route.continue()
  })
  return release
}

const holdFeed = (page: Page) => hold(page, '**/epcis.json*')

// Serve the feed with an edit the signature does not cover.
async function editFeed(
  page: Page, edit: (doc: Record<string, unknown>) => void
) {
  await page.route('**/epcis.json*', async (route) => {
    const res = await route.fetch()
    const doc = await res.json() as Record<string, unknown>
    edit(doc)
    await route.fulfill({ response: res, json: doc })
  })
}

// Wait until the timeline has either shown its events or
// given up on the feed, and read the page then.
async function settled(page: Page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    const timeline = root?.querySelector('dpp-timeline') as HTMLElement | null
    if (!timeline) return false
    const hidden = getComputedStyle(timeline).display === 'none'
    return hidden || (root?.querySelectorAll('.event').length ?? 0) > 0
  })
  return layout(page)
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

test('the card does not move while the feed is judged', async ({ page }) => {
  const release = await hold(page, '**/keys/platform.json*')
  const feed = page.waitForResponse('**/epcis.json*')
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.card')
  })
  await feed

  // The feed is in, its key is not: no events yet, and the
  // strip keeps its space.
  const before = await layout(page)
  expect(before.dots).toBe(0)
  expect(before.timelineDisplay).not.toBe('none')

  release()
  const after = await settled(page)
  expect(after.dots).toBeGreaterThan(0)
  expect(after.cardTop).toBe(before.cardTop)
})

test('a feed whose signature fails shows no timeline', async ({ page }) => {
  await editFeed(page, (doc) => {
    const body = doc.epcisBody as { eventList: Record<string, unknown>[] }
    body.eventList[0].eventTime = '2020-01-01T00:00:00Z'
  })
  await page.goto('/')

  const after = await settled(page)
  expect(after.dots).toBe(0)
  expect(after.timelineDisplay).toBe('none')
})

test('a feed naming another passport shows no timeline', async ({ page }) => {
  await editFeed(page, (doc) => { doc['transpareo:code'] = 'demo-2026-x999' })
  await page.goto('/')

  const after = await settled(page)
  expect(after.dots).toBe(0)
  expect(after.timelineDisplay).toBe('none')
})

// A link into one event is the exception: the boot waits for
// the feed and its verdict, so the page opens on that event.
test('a link into one event opens on it', async ({ page }) => {
  const release = await hold(page, '**/keys/platform.json*')
  await page.goto('/#evt-3', { waitUntil: 'domcontentloaded' })

  // Ready, with the feed in and its key held: the boot shell
  // stays up.
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.boot-shell-ready')
  })
  expect((await layout(page)).card).toBe(false)

  release()
  const opened = await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    if (!root?.querySelector('.card')) return null
    return { scrubbing: !!root.querySelector('.stage.scrubbing') }
  })
  expect(await opened.jsonValue()).toEqual({ scrubbing: true })
})
