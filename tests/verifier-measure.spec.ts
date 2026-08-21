/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Measure contract of the <dpp-verifier> widget. It states
 * no width of its own: the page sizes the box, the widget
 * fills it. A cap declared inside the shadow root would be
 * one the embedding page can neither see nor override, so
 * the first test reads the widget against a container that
 * changes width under it.
 *
 * Mounted in the renderer's verifier mode there is no host
 * container to speak of, so the shell hands the widget the
 * measure the passport card uses, which the second test
 * reads back on a full-width page.
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// What the shell falls back to with no --content-max-width
// declared, and the viewport the browser suite runs at.
const CONTENT_MAX = 830
const VIEWPORT = 1280

async function open(page: Page): Promise<void> {
  await page.goto('/verifier.html')
  await page.waitForFunction(() => {
    const host = document.querySelector('dpp-verifier')
    return host?.shadowRoot?.querySelector('.verifier-row') != null
  })
}

test('the widget fills the box the page gives it', async ({ page }) => {
  await open(page)

  const measured = await page.evaluate(() => {
    const host = document.querySelector('dpp-verifier')!
    const inner = host.shadowRoot!.querySelector('.verifier')!
    const widths = (): { host: number; inner: number } => ({
      host: host.getBoundingClientRect().width,
      inner: inner.getBoundingClientRect().width
    })

    // The demo shell holds the widget at its own measure;
    // widening it stands in for a host page that gives the
    // widget more room than the widget ever asked for.
    const held = widths()
    document.body.style.maxWidth = '1100px'
    return { held, widened: widths() }
  })

  expect(measured.held.inner).toBe(measured.held.host)
  expect(measured.widened.inner).toBe(measured.widened.host)
  expect(measured.widened.host).toBeGreaterThan(measured.held.host)
})

test('verifier mode hands the widget the card measure', async ({ page }) => {
  await page.setViewportSize({ width: VIEWPORT, height: 900 })
  await page.goto('/')

  // A verifier shell page carries no `src`: there is no
  // manifest to fetch, the widget goes up in place of the
  // passport tree.
  const box = await page.evaluate(async () => {
    const tm = document.createElement('transpareo-time-machine')
    tm.setAttribute('verifier', '')
    document.body.appendChild(tm)
    const widget = (): Element | null | undefined =>
      tm.shadowRoot?.querySelector('dpp-verifier')
    for (let wait = 0; wait < 40 && !widget(); wait++) {
      await new Promise((r) => setTimeout(r, 25))
    }
    const rect = widget()!.getBoundingClientRect()
    const shell = tm.getBoundingClientRect()
    return {
      width: rect.width,
      left: rect.left - shell.left,
      right: shell.right - rect.right
    }
  })

  expect(box.width).toBe(CONTENT_MAX)

  // Centred in the shell the same way the passport card
  // is, read against the shell's own box so a scrollbar
  // gutter does not count as an offset.
  expect(box.left).toBeCloseTo(box.right, 0)
})
