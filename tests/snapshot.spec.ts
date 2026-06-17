/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Single-snapshot mode: the element's `src` points at one
 * signed snapshot instead of a manifest. The renderer shows
 * that frozen version, hides the timeline/history (a lone
 * snapshot has no version list and no EPCIS events), derives
 * the locale picker from the snapshot's localized strings,
 * and verifies the snapshot's own proof. Served by
 * `npm run dev` at /snapshot.html.
 */
import { test, expect } from '@playwright/test'

test('single snapshot renders, hides the timeline, and verifies', async ({
  page,
}) => {
  await page.goto('/snapshot.html', { waitUntil: 'networkidle' })

  // Wait for the tree to mount and the chip to settle on a
  // verdict (verification fetches the proof keys).
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    const chip = root?.querySelector('dpp-verification-chip .chip')
    return !!chip && /state-(verified|failed)/.test(chip.className)
  })

  const r = await page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const timeline = root.querySelector('dpp-timeline')
    const chip = root.querySelector('dpp-verification-chip .chip')
    const hero = root.querySelector('dpp-hero')
    return {
      productRendered: (hero?.textContent ?? '').trim().length > 0,
      timelineDisplay: timeline
        ? getComputedStyle(timeline).display
        : null,
      chipClass: chip?.className ?? null,
      localePicker: root.querySelector('.locale-wrap') != null,
    }
  })

  expect(r.productRendered).toBe(true)

  // No version list / EPCIS events, so the timeline (and its
  // "show history" toggle) is hidden.
  expect(r.timelineDisplay).toBe('none')

  // The lone snapshot's own 2-of-2 proof verifies, with no
  // manifest signature or chain to lean on.
  expect(r.chipClass).toContain('state-verified')

  // availableLocales is derived from the snapshot's localized
  // strings, so the picker appears when >1 locale is present.
  expect(r.localePicker).toBe(true)
})
