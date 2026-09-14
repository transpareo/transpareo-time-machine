/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The withdrawal band in a real browser, on artefacts
 * rewritten in flight to carry the withdrawal keys: the
 * manifest for a published passport, and the document
 * itself for a DPP served as one. No shipped fixture is
 * out of circulation, and the unit tests mount the
 * component without the stylesheet, so this is the only
 * place the band's rendered geometry is checked, and the
 * only place the lone-document boot is exercised through
 * the renderer's own fetch.
 *
 * It exists for defects those unit tests could not see.
 * The successor row is hidden by attribute, and the row's
 * own `display` beat the user agent's rule for `[hidden]`,
 * so a void with no successor showed an empty label and an
 * empty chip: the property said hidden, the pixels said
 * otherwise. And a glyph in front of the text carried every
 * line in the band out of the column the rest of the card
 * starts on, which is why the left edges are measured here
 * against the card's own content rather than described.
 *
 * Rewriting the manifest breaks its signature, and the
 * band renders anyway. That is deliberate: a passport out
 * of circulation says so whether or not its proofs check
 * out, and the chip reports the signature separately.
 */
import { test, expect } from '@playwright/test'

type Page = import('@playwright/test').Page

// Serve the real seeded manifest with the carrier state
// merged in, the way a publisher's own manifest carries it.
async function withdrawn(page: Page, extra: Record<string, unknown>) {
  await page.route('**/manifest.json*', async (route) => {
    const res = await route.fetch()
    const body = await res.json() as Record<string, unknown>
    await route.fulfill({
      response: res,
      json: { ...body, ...extra },
    })
  })
}

function band(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    const el = root?.querySelector('.withdrawal') as HTMLElement | null
    if (!el) return null
    const row = el.querySelector('.withdrawal-successor') as HTMLElement
    const code = el.querySelector('.withdrawal-code') as HTMLAnchorElement
    const title = el.querySelector('.withdrawal-title') as HTMLElement
    const hero = root!.querySelector('.dpp-hero-image') as HTMLElement
    return {
      title: el.querySelector('.withdrawal-title')?.textContent?.trim(),
      body: el.querySelector('.withdrawal-body')?.textContent?.trim(),
      rowDisplay: getComputedStyle(row).display,
      code: code.textContent?.trim(),
      href: code.getAttribute('href'),

      // Where the band's text starts, against where the
      // card's own content starts. They must be the same.
      textLeft: Math.round(title.getBoundingClientRect().left),
      contentLeft: Math.round(hero.getBoundingClientRect().left)
    }
  })
}

async function boot(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.withdrawal')
  })
}

test('a void with no successor shows no successor row', async ({ page }) => {
  await withdrawn(page, {
    voidedAt: '2026-09-13T21:42:31Z',
    voidedReason: 'recalled',
  })
  await boot(page)

  const b = await band(page)
  expect(b!.title).toBe('This passport has been withdrawn')
  expect(b!.body).toContain('taken out of circulation')

  // Every line in the band starts on the column the logo,
  // the picture and the product name start on.
  expect(b!.textLeft).toBe(b!.contentLeft)

  // The row is in the DOM and must take no space.
  expect(b!.rowDisplay).toBe('none')
})

test('a supersede shows the successor and links it', async ({ page }) => {
  await withdrawn(page, {
    supersededBy: {
      code: 'demo-2026-t002',
      url: 'https://demo.example/01/04012345678902',
    },
  })
  await boot(page)

  const b = await band(page)
  expect(b!.title).toBe('A newer passport replaces this one')
  expect(b!.rowDisplay).toBe('flex')
  expect(b!.code).toBe('demo-2026-t002')
  expect(b!.href).toBe('https://demo.example/01/04012345678902')
  expect(b!.textLeft).toBe(b!.contentLeft)
})

test('a successor with no address is text, not a link', async ({ page }) => {
  await withdrawn(page, { supersededBy: { code: 'demo-2026-t002' } })
  await boot(page)

  const b = await band(page)
  expect(b!.rowDisplay).toBe('flex')
  expect(b!.href).toBeNull()
})

// The documented minimal integration: `src` pointed at the
// passport URL itself, which answers with the dataset and
// no manifest beside it. A publisher states the carrier's
// withdrawal on that document, and it carries no proof, so
// this also covers the renderer booting an unsigned
// document into single-snapshot mode.
test('a lone document states its own withdrawal', async ({ page }) => {
  await page.route('**/manifest.json*', async (route) => {
    const manifest = await (await route.fetch()).json() as {
      currentVersion: number
      versions: Array<{ number: number; url: string }>
    }
    const current = manifest.versions
      .find((v) => v.number === manifest.currentVersion)!
    const url = new URL(current.url, route.request().url()).toString()
    const snapshot = await (await page.request.get(url)).json() as
      Record<string, unknown>
    delete snapshot.proof
    await route.fulfill({
      json: {
        ...snapshot,
        voidedAt: '2026-09-13T21:42:31Z',
        voidedReason: 'destroyed',
      },
    })
  })
  await boot(page)

  const b = await band(page)
  expect(b!.title).toBe('This passport has been withdrawn')

  // The sentence names the publisher off the document
  // itself: there is no manifest here to name one.
  expect(b!.body).toBe('The product was destroyed, and Nordic Wear '
    + 'withdrew its passport on September 13, 2026.')
  expect(b!.rowDisplay).toBe('none')
})

test('a passport that stands renders no band at all', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.stage')
  })
  const present = await page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.withdrawal')
  })
  expect(present).toBe(false)
})
