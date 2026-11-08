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
 * document, the section painting only once it clears, the
 * section leaving when the reader steps into the past, the
 * `?show=` gate holding back its on-demand rows, and one a
 * signed-in reader's view serves leaving for that view.
 */
import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tsImport } from 'tsx/esm/api'

type Page = import('@playwright/test').Page

const HOST = 'http://localhost:5173'

// `suffix` is a query string or a hash; the page is matched
// with either.
async function bootVolturra(page: Page, suffix = ''): Promise<void> {
  const home = (url: URL): boolean => url.origin === HOST
    && url.pathname === '/'
  await page.route(home, async (route) => {
    const res = await route.fetch()
    const html = (await res.text())
      .replaceAll('nordic-wear-tshirt', 'volturra-pulse-2000')
      .replaceAll('demo-2026-t001', 'demo-2026-b001')
    await route.fulfill({ response: res, body: html })
  })
  await page.goto(`/${suffix}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.dpp-properties')
  })
}

// A rewritten read can still be in flight when a test ends,
// and the closing context drops the body it fetched. Every
// route here is hit while the test runs, so a broken handler
// fails it there; only reads still in flight at the end are
// let go.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

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

type Snapshot = {
  credentialSubject: {
    product: { properties: Array<{ propertyID: string, access?: string }> }
  }
}

// Puts two of the current version's live rows on demand:
// one the live document holds a reading for, one it does
// not. The rewrite breaks the snapshot's proof; the live
// document keeps its own, so its readings still paint.
async function gateLiveRows(page: Page): Promise<void> {
  const gated = ['stateOfCharge', 'capacityThroughput']
  await page.route('**/v/4.json*', async (route) => {
    const res = await route.fetch()
    const doc = await res.json() as Snapshot
    for (const row of doc.credentialSubject.product.properties) {
      if (gated.includes(row.propertyID)) row.access = 'onDemand'
    }
    await route.fulfill({ response: res, json: doc })
  })
}

// Without a token the on-demand rows stay out, and so does
// the reading for one of them: no row paints under its raw
// key. The public live rows show as before.
test('keeps on-demand live values behind ?show=', async ({ page }) => {
  await gateLiveRows(page)
  await bootVolturra(page)

  await expect.poll(async () => (await liveSection(page)).heading).toBe(true)
  expect((await liveSection(page)).rows).toEqual([
    'State of certified energy96 %',
    'Remaining capacity38.6 Ah'
  ])
})

test('shows the on-demand live values ?show= unlocks', async ({ page }) => {
  await gateLiveRows(page)
  await bootVolturra(page, '?show=stateOfCharge,capacityThroughput')

  await expect.poll(async () => (await liveSection(page)).heading).toBe(true)
  expect((await liveSection(page)).rows).toEqual([
    'State of charge81 %',
    'State of certified energy96 %',
    'Remaining capacity38.6 Ah',
    'Capacity throughput0 AhReading at publish'
  ])
})

// The property list's rows by the heading above them.
function propertySections(): Record<string, string[]> {
  const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
  const out: Record<string, string[]> = {}
  let heading = ''
  for (const node of root.querySelector('.dpp-properties')!.children) {
    const text = node.textContent!
    if (node.matches('.dpp-properties-heading')) heading = text
    if (node.matches('.dpp-property-row')) (out[heading] ??= []).push(text)
  }
  return out
}

const PASSPORT = 'https://volturra.example/dpp/demo-2026-b001'
const ISSUER = 'did:web:volturra.example'

type Signer = typeof import('../scripts/seed/ecdsa-sd-signing')

// The reader's view of v4 serving `rows`, minted with the
// seed's demo keys under the fixture's handle, code and DIDs,
// so the key documents the fixture serves verify it. The
// signer imports its contexts as bare JSON, which this
// runner's loader refuses, so tsx loads it as the seed does.
async function serveReaderView(
  page: Page, rows: ReadonlyArray<Record<string, unknown>>
): Promise<void> {
  const path = '../scripts/seed/ecdsa-sd-signing.ts'
  const signer = await tsImport(path, import.meta.url) as Signer
  const body = {
    '@id': PASSPORT,
    version: 4,
    issuer: { '@type': 'Organization', name: 'Volturra Energia', did: ISSUER },
    product: { '@type': 'Product', properties: rows }
  }

  // The signer writes its key documents into `dir`; the page
  // reads the fixture's own copies, so `dir` goes once minted.
  const dir = mkdtempSync(join(tmpdir(), 'sd-'))
  try {
    const issuer = await signer.buildEcdsaSdIssuer(
      dir, 'volturra-pulse-2000', 'demo-2026-b001', '2026-11-07T12:00:00Z',
      ISSUER, 'did:web:transpareo.example'
    )
    const answer = { json: await issuer.issue(body) }
    await page.route('**/private/v4.json', (route) => route.fulfill(answer))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// With the token, a gated live row the reader's view serves
// shows once, as served; the other gated row stays in the box.
test('shows a served on-demand row with the served rows', async ({ page }) => {
  const served = {
    '@type': 'PropertyValue',
    propertyID: 'stateOfCharge',
    name: [{ '@value': 'State of charge', '@language': 'en' }],
    value: 100,
    unitCode: 'P1',
    dynamic: true,
    access: 'onDemand'
  }
  await gateLiveRows(page)
  await serveReaderView(page, [served])
  await bootVolturra(page, '?show=stateOfCharge,capacityThroughput')

  await expect.poll(() => page.evaluate(propertySections)).toEqual({
    'Current state': [
      'State of certified energy96 %',
      'Remaining capacity38.6 Ah',
      'Capacity throughput0 AhReading at publish'
    ],
    'Additional product data': ['State of charge100 %Reading at publish']
  })
})
