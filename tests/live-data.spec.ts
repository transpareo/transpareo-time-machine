/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The live block in a real browser, on the Volturra battery
 * passport, whose seeded dynamic-data document is signed
 * with the fixture's platform key. The dev server serves
 * the Nordic Wear demo, so the page is rewritten in flight
 * to boot the Volturra manifest instead; every artefact
 * below it is served as seeded, so the signatures are real.
 *
 * What the unit tests cannot show: the signature check
 * running through the browser's WebCrypto against the key
 * document, the section painting only once it clears, and
 * the section leaving when the reader steps into the past.
 */
import { test, expect } from '@playwright/test'

type Page = import('@playwright/test').Page

async function bootVolturra(page: Page, hash = ''): Promise<void> {
  await page.route('http://localhost:5173/', async (route) => {
    const res = await route.fetch()
    const html = (await res.text())
      .replaceAll('nordic-wear-tshirt', 'volturra-pulse-2000')
      .replaceAll('demo-2026-t001', 'demo-2026-b001')
    await route.fulfill({ response: res, body: html })
  })
  await page.goto(`/${hash}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.dpp-properties')
  })
}

// The version chip settled on verified: the snapshot rows
// without a value are signed like every other row.
function verifiedChip(): boolean {
  const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
  return /Verified/.test(root.querySelector('button.chip')!.textContent!)
}

// The text of every metric tile on the card.
function tileLabels(): string[] {
  const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
  return [...root.querySelectorAll('.dpp-metric')]
    .map((tile) => tile.textContent!.trim())
}

function liveSection(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const heading = [...root.querySelectorAll('.dpp-properties-heading')]
      .find((h) => h.textContent === 'Current state')
    return {
      heading: heading != null,
      updated: root.querySelector('.dpp-properties-updated')?.textContent,
      rows: [...root.querySelectorAll('.dpp-property-row')]
        .map((r) => r.textContent),
    }
  })
}

// Opens the proof modal and reads its headline and the
// live-data signature section.
async function proof(page: Page) {
  await page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    ;(root.querySelector('button.chip') as HTMLButtonElement).click()
  })
  return page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const sections = [
      ...root.querySelectorAll('dpp-verification-modal section'),
    ]
    const live = sections
      .find((s) => /Live data signature/i.test(s.textContent!))
    return {
      headline: root.querySelector('.proof-status')?.textContent?.trim(),
      live: live != null,
    }
  })
}

test('paints the signed live values today', async ({ page }) => {
  await bootVolturra(page)

  await expect.poll(async () => (await liveSection(page)).heading).toBe(true)
  const live = await liveSection(page)
  expect(live.updated).toMatch(/^Updated /)
  expect(live.rows).toEqual([
    'State of charge81 %',
    'State of certified energy96 %',
    'Remaining capacity38.6 Ah',
    'Capacity throughput0 AhReading at publish',
  ])

  // The marked rows show in the live block only.
  expect(await page.evaluate(tileLabels)).not.toContain('State of charge')
  await expect.poll(() => page.evaluate(verifiedChip)).toBe(true)

  const p = await proof(page)
  expect(p.live).toBe(true)
})

// A value changed after signing: the signature fails, every
// live property shows the reading sealed at publish, and the
// proof modal cannot claim every signature holds.
test('keeps tampered live values off the page', async ({ page }) => {
  await page.route('**/dynamic-data.json*', async (route) => {
    const res = await route.fetch()
    const doc = await res.json() as { values: Array<{ value: unknown }> }
    doc.values[0].value = 100
    await route.fulfill({ response: res, json: doc })
  })
  await bootVolturra(page)

  // Every version is genuine, so the mismatch can only be
  // the live document's, and its verdict is in.
  await expect.poll(async () => (await proof(page)).headline)
    .toBe('Signature mismatch')
  expect((await proof(page)).live).toBe(true)
  const live = await liveSection(page)
  expect(live.updated).toBeUndefined()
  expect(live.rows).toEqual([
    'State of charge100 %Reading at publish',
    'State of certified energy100 %Reading at publish',
    'Remaining capacity40 AhReading at publish',
    'Capacity throughput0 AhReading at publish',
  ])
})

// The live values belong to today; a past version shows
// what was signed then and nothing newer.
test('leaves the live values out of a past version', async ({ page }) => {
  await bootVolturra(page, '#evt-1')

  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('main.stage.scrubbing')
  })
  expect((await liveSection(page)).heading).toBe(false)

  // The past version shows its marked rows as static tiles,
  // each saying its value is the reading sealed at publish.
  const tiles = await page.evaluate(tileLabels)
  expect(tiles).toContain('State of charge100 %Reading at publish')

  // Back to today, where the section shows: the document
  // was in all along.
  await page.evaluate(() => { location.hash = '' })
  await expect.poll(async () => (await liveSection(page)).heading).toBe(true)
})
