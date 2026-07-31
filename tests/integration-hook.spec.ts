/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The integration hook's `state` property. The
 * `transpareo-time-machine:state` event has no replay, so an
 * integration script that attaches its listener after the
 * first dispatch depends on this getter to learn the DPP
 * identity at all. Two properties matter and are pinned here:
 * the getter answers once the manifest has loaded even though
 * no event is coming, and it is a live read of what the SPA
 * is showing rather than a copy of the boot state.
 *
 * Runs against `npm run dev`, which renders the full fixture
 * DPP so the timeline has versions to scrub through.
 */
import { test, expect, type Page } from '@playwright/test'
import type { TimeMachineStateDetail } from '../types'

const EV = 'transpareo-time-machine:state'

declare global {
  interface Window {
    __ttmStates?: TimeMachineStateDetail[]
  }
}

// Mount, then attach a recorder the way a late-loading
// integration script would: well after the first dispatch has
// come and gone.
async function attachLate(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => {
    const tm = document.querySelector('transpareo-time-machine')
    return tm?.shadowRoot?.querySelector('dpp-hero') != null
  })
  await page.evaluate((ev) => {
    const tm = document.querySelector('transpareo-time-machine')!
    window.__ttmStates = []
    tm.addEventListener(ev, (e) => {
      const ce = e as CustomEvent<TimeMachineStateDetail>
      window.__ttmStates!.push(ce.detail)
    })
  }, EV)
}

test('state answers a late listener that missed the dispatch', async ({
  page,
}) => {
  await attachLate(page)

  const r = await page.evaluate(() => {
    const tm = document.querySelector('transpareo-time-machine')!
    return { state: tm.state, replayed: window.__ttmStates!.length }
  })

  // Nothing is replayed to the late listener, which is exactly
  // why the getter has to answer.
  expect(r.replayed).toBe(0)
  expect(r.state).not.toBeNull()

  const s = r.state!
  expect(s.code.length).toBeGreaterThan(0)
  expect(s.manifestUrl).toContain('manifest.json')
  expect(s.locale.length).toBeGreaterThan(0)

  // A fresh load carries no URL hash, so the visitor is on the
  // current version and a CTA is safe to show.
  expect(s.version).toBe(s.currentVersion)
})

test('state follows the timeline instead of freezing at boot', async ({
  page,
}) => {
  await attachLate(page)

  const r = await page.evaluate(async (ev) => {
    const tm = document.querySelector('transpareo-time-machine')!
    const dots = tm.shadowRoot!.querySelectorAll<HTMLElement>(
      '[data-event-id]',
    )
    const ids = [...new Set([...dots].map((el) => el.dataset.eventId!))]

    // The hash drives the focused event, and the dispatch that
    // follows it is the settle signal. Time out rather than
    // hang if a step turns out to focus nothing.
    const step = (id: string): Promise<void> => new Promise((resolve) => {
      const done = (): void => {
        tm.removeEventListener(ev, done)
        resolve()
      }
      tm.addEventListener(ev, done)
      window.location.hash = id
      setTimeout(done, 1000)
    })

    for (const id of ids) {
      await step(id)
      const s = tm.state
      if (s && s.version !== s.currentVersion) break
    }
    return { ids: ids.length, state: tm.state, seen: window.__ttmStates! }
  }, EV)

  expect(r.ids).toBeGreaterThan(0)
  expect(r.seen.length).toBeGreaterThan(0)

  // Scrubbing reached a historical version, and the getter
  // reports it rather than the version the page booted on.
  const s = r.state!
  expect(s.version).not.toBe(s.currentVersion)

  // The getter and the event are the same identity, built in
  // one place: the last dispatch matches the live read.
  expect(s).toEqual(r.seen[r.seen.length - 1])
})
