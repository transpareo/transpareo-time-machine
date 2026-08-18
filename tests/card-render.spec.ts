/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Rendered-style guards for the live card, each locking in a
 * decision the markup can't show. The resting card carries no
 * `blur()` in its filter chain, since a zero length would
 * change no pixels yet still put it on the filter path, while
 * a scrub in flight still gets its transit blur. And the
 * verification chip's label sits on the orb's axis on its
 * own, with no optical nudge on top of the flex centring.
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

// Everything below <transpareo-time-machine> renders into its
// shadow root, so every query hops through it.
async function mount(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('dpp-deck > .card')
  })
}

// Boot into a version behind the current one. Not every
// timeline dot carries a version, so walk them until the
// element reports one, then load that hash fresh: switching
// versions in a page that is already up runs the transit
// tween, whose blur is still easing out well after the view
// flips, and a resting card is what these tests read.
async function bootHistorical(page: Page): Promise<void> {
  await mount(page)
  const id = await page.evaluate(async () => {
    const tm = document.querySelector('transpareo-time-machine')!
    const dots = tm.shadowRoot!.querySelectorAll<HTMLElement>('[data-event-id]')
    const ids = new Set([...dots].map((el) => el.dataset.eventId!))
    const behind = (): boolean => {
      const s = tm.state
      return s != null && s.version !== s.currentVersion
    }
    for (const id of ids) {
      window.location.hash = id
      for (let wait = 0; wait < 20 && !behind(); wait++) {
        await new Promise((r) => setTimeout(r, 50))
      }
      if (behind()) return id
    }
    return null
  })
  expect(id).not.toBeNull()

  await page.goto('/#' + id)
  await page.reload()
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.stage.scrubbing dpp-deck > .card')
  })
}

function cardFilter(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    return getComputedStyle(root.querySelector('dpp-deck > .card')!).filter
  })
}

test('a resting card on the current version carries no filter',
  async ({ page }) => {
    await mount(page)
    expect(await cardFilter(page)).toBe('none')
  })

test('a resting card in the historical view only desaturates',
  async ({ page }) => {
    await bootHistorical(page)
    const filter = await cardFilter(page)
    expect(filter).toContain('saturate(0.9)')
    expect(filter).not.toContain('blur')
  })

test('a scrub in flight blurs the card', async ({ page }) => {
  await bootHistorical(page)

  // Horizontal wheel over the deck is the desktop scrub, and
  // it only answers while the history is open, which the
  // deep link above takes care of.
  const deck = await page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const b = root.querySelector('dpp-deck')!.getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + 40 }
  })
  await page.mouse.move(deck.x, deck.y)
  await page.mouse.wheel(40, 0)

  // Wait for the blur rather than reading the frame straight
  // after the gesture: the wheel handler and the filter
  // transition both land a tick later, and how much later
  // depends on how loaded the machine is.
  const blur = await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const card = root.querySelector('dpp-deck > .card')!
    const m = /blur\(([\d.]+)px\)/.exec(getComputedStyle(card).filter)
    return m ? { radius: Number(m[1]) } : null
  })

  // liveSlotStyle floors the transit blur clear of zero, so a
  // zero radius is a regression rather than a rounding
  // artefact. The wait above accepts blur(0px) so that it
  // fails here, with the radius, instead of timing out.
  expect((await blur.jsonValue())!.radius).toBeGreaterThan(0)

  // One tick is under the commit distance, so the deck eases
  // back and the blur leaves the chain again.
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const card = root.querySelector('dpp-deck > .card')!
    return !getComputedStyle(card).filter.includes('blur')
  })
  expect(await cardFilter(page)).toBe('saturate(0.9)')
})

test('the verification chip label centres on the orb', async ({ page }) => {
  await mount(page)
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('dpp-verification-chip .label-text')
      ?.textContent
  })

  const axis = await page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const chip = root.querySelector('dpp-verification-chip .chip')!
    const mid = (el: Element): number => {
      const b = el.getBoundingClientRect()
      return b.top + b.height / 2
    }
    return {
      orb: mid(chip.querySelector('.orb')!),
      label: mid(chip.querySelector('.label-text')!)
    }
  })

  // Half a pixel of tolerance: enough for the rounding a
  // fractional line box leaves, far short of the 2px nudge
  // the label used to carry.
  expect(Math.abs(axis.orb - axis.label)).toBeLessThan(0.5)
})
