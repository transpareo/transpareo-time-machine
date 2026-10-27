/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The workspace's background pattern behind the passport.
 * The branding stylesheet names a tile (`--background-pattern`)
 * with its colour, opacity and width, and the renderer lays
 * it over `--body-background`, under every surface it draws.
 * The tokens are appended to the seeded branding.css in
 * flight, the way the publisher's export carries them.
 *
 * Runs against `npm run dev`.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'

type Page = import('@playwright/test').Page

const PUBLIC = join(import.meta.dirname, '..', 'public')

const TILE = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/'
  + '2000/svg\' width=\'12\' height=\'12\'%3E%3Cpath d=\'M0 12L12 0\' '
  + 'stroke=\'%23000\'/%3E%3C/svg%3E")'

const PATTERN = {
  '--background-pattern': TILE,
  '--pattern-color': '#112233',
  '--pattern-opacity': '0.25',
  '--pattern-size': '24px'
}

// Served from the seeded file on disk rather than through
// route.fetch(), which stalled the stylesheet (and so the
// page's scripts) under the full suite's parallel load.
async function branded(page: Page, tokens: Record<string, string>) {
  await page.route('**/branding.css', async (route) => {
    const path = new URL(route.request().url()).pathname
    const seeded = await readFile(join(PUBLIC, path), 'utf8')
    const decls = Object.entries(tokens)
      .map(([name, value]) => `${name}: ${value};`)
      .join(' ')
    const body = `${seeded}\n:root { ${decls} }\n`
    await route.fulfill({ contentType: 'text/css', body })

  // One shot, so no interception is left to tear down under
  // the passport's own reads at the test's end; Firefox
  // aborts those.
  }, { times: 1 })
}

async function open(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return root?.querySelector('.card') != null
  })
}

// The layer is the host's ::before; with no pattern its
// `content` computes to `none` and nothing is generated.
async function layer(page: Page) {
  return page.evaluate(() => {
    const host = document.querySelector('transpareo-time-machine')!
    const own = getComputedStyle(host)
    const before = getComputedStyle(host, '::before')
    return {
      marked: host.hasAttribute('data-pattern'),
      isolation: own.isolation,
      content: before.content,
      display: before.display,
      position: before.position,
      zIndex: before.zIndex,
      pointerEvents: before.pointerEvents,
      color: before.backgroundColor,
      opacity: before.opacity,
      mask: before.maskImage || before.webkitMaskImage,
      maskSize: before.maskSize || before.webkitMaskSize
    }
  })
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('the pattern tokens draw a masked layer behind the passport', async ({ page }) => {
  await branded(page, PATTERN)
  await open(page)
  const l = await layer(page)

  expect(l.marked).toBe(true)
  expect(l.content).not.toBe('none')
  expect(l.position).toBe('absolute')
  expect(l.zIndex).toBe('-1')
  expect(l.isolation).toBe('isolate')
  expect(l.pointerEvents).toBe('none')
  expect(l.color).toBe('rgb(17, 34, 51)')
  expect(l.opacity).toBe('0.25')
  expect(l.mask).toContain('data:image/svg+xml')
  expect(l.maskSize).toBe('24px auto')
})

test('the stuck brand bar keeps its blur over the pattern', async ({ page }) => {
  await branded(page, PATTERN)
  await open(page)
  await page.mouse.wheel(0, 800)

  const bar = page.locator('transpareo-time-machine .brandbar.stuck')
  await expect(bar).toHaveCount(1)
  const blur = await bar.evaluate((el) => getComputedStyle(el).backdropFilter)

  expect(blur).toBe('blur(8px)')
})

test('the language picker on the pattern is filled', async ({ page }) => {
  await branded(page, PATTERN)
  await open(page)
  const fill = await page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const picker = root.querySelector('.locale-switch')!
    return getComputedStyle(picker).backgroundColor
  })

  // Opaque: no alpha channel in either serialization the
  // engines use for a color-mix() result.
  expect(fill).not.toMatch(/rgba\(|\/\s*0?\.\d/)
})

test('no pattern tokens, no layer', async ({ page }) => {
  await open(page)
  const l = await layer(page)

  expect(l.marked).toBe(false)
  expect(l.content).toBe('none')
  expect(l.isolation).toBe('auto')
})

test('a pattern of none draws no layer', async ({ page }) => {
  await branded(page, { ...PATTERN, '--background-pattern': 'none' })
  await open(page)
  const l = await layer(page)

  expect(l.marked).toBe(false)
  expect(l.content).toBe('none')
})

test('print leaves the pattern out', async ({ page }) => {
  await branded(page, PATTERN)
  await open(page)
  await page.emulateMedia({ media: 'print' })
  const l = await layer(page)

  expect(l.display).toBe('none')
})
