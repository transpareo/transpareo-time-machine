/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Rendered guards for the time axis under the strip. The
 * marks are spaced from the width the strip actually
 * has, so a phone gets a coarser step instead of labels
 * printed over each other, and a rotation re-resolves the
 * axis without a reload. Both are invisible to the markup
 * and only measurable once the browser has laid the strip
 * out.
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

interface Box {
  text: string
  left: number
  right: number
}

// The strip renders into the shadow root and starts
// collapsed, so every query hops through the root and the
// toggle opens it first.
async function openStrip(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('dpp-timeline .strip')
  })
  await page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const tl = root.querySelector('dpp-timeline')!
    const strip = tl.querySelector('.strip')!
    if (strip.getBoundingClientRect().height < 10) {
      tl.querySelector<HTMLElement>('.versions-toggle')!.click()
    }
  })
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('dpp-timeline .tick-label')
  })
}

// Label boxes in reading order, with the pane scrolled to
// `frac` of its travel (0 = start, 1 = end).
async function labelsAt(page: Page, frac: number): Promise<Box[]> {
  const boxes = await page.evaluate((frac) => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const tl = root.querySelector('dpp-timeline')!
    const pane = tl.querySelector('.scroll-pane')!
    pane.scrollLeft = (pane.scrollWidth - pane.clientWidth) * frac
    return [...tl.querySelectorAll('.tick-label')].map((l) => {
      const b = l.getBoundingClientRect()
      return { text: l.textContent ?? '', left: b.left, right: b.right }
    })
  }, frac)
  return boxes
}

function expectNoOverprint(boxes: Box[]): void {
  for (let i = 1; i < boxes.length; i++) {
    const gap = boxes[i].left - boxes[i - 1].right
    expect(
      gap, `"${boxes[i - 1].text}" runs into "${boxes[i].text}"`
    ).toBeGreaterThanOrEqual(0)
  }
}

for (const [w, h] of [[390, 844], [844, 390], [1280, 800]]) {
  test(`the axis keeps its labels apart at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await openStrip(page)

    expectNoOverprint(await labelsAt(page, 0))
    expectNoOverprint(await labelsAt(page, 1))
  })
}

test('a label rides the left edge to the end of the axis',
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openStrip(page)

    // Scrolled to the far end, the last mark's slot still
    // covers the pane, so its label sits pinned at the
    // edge instead of having slid out of view with a
    // slot that stopped at its own width.
    const boxes = await labelsAt(page, 1)
    const pane = await page.evaluate(() => {
      const host = document.querySelector('transpareo-time-machine')!
      return host.shadowRoot!.querySelector('dpp-timeline .scroll-pane')!
        .getBoundingClientRect().left
    })
    const visible = boxes.filter((b) => b.left >= pane - 1)
    expect(visible.length).toBeGreaterThan(0)
    expect(visible[0].left - pane).toBeLessThan(20)
  })

test('a rotation re-resolves the axis', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openStrip(page)
  const portrait = await labelsAt(page, 0)

  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForFunction((count) => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return root!.querySelectorAll('dpp-timeline .tick-label').length !== count
  }, portrait.length)

  const landscape = await labelsAt(page, 0)
  expect(landscape.length).toBeGreaterThan(portrait.length)
  expectNoOverprint(landscape)
})
