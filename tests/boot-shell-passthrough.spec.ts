/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The loading shell passes the host page's boot composition
 * through without touching its geometry. A host that lays its
 * boot frame out to line up with the card it resolves into has
 * already placed it; centring it in the viewport and insetting
 * it here moved the picture inward on upgrade and outward
 * again on mount, a visible step in both directions that no
 * host could correct from its own stylesheet.
 *
 * The error and retired shells keep the centring: they render
 * their own text and have nothing to line up with.
 */
import { test, expect } from '@playwright/test'

// Hold the manifest so the loading shell stays up long enough
// to read. Released at the end of each test.
async function holdManifest(page: import('@playwright/test').Page) {
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  await page.route('**/manifest.json*', async (route) => {
    await held
    await route.continue()
  })
  return release
}

function shellBox(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    const shell = root?.querySelector('.boot-shell') as HTMLElement | null
    if (!shell) return null
    const cs = getComputedStyle(shell)
    return {
      classes: shell.className,
      display: cs.display,
      paddingTop: cs.paddingTop,
      paddingLeft: cs.paddingLeft,
      alignItems: cs.alignItems,
      justifyContent: cs.justifyContent
    }
  })
}

test('the loading shell adds no padding of its own', async ({ page }) => {
  const release = await holdManifest(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.boot-shell')
  })

  const box = await shellBox(page)
  expect(box).not.toBeNull()
  expect(box!.classes).toContain('boot-shell-loading')

  // Any of these would move a boot frame away from the
  // measurements its host authored it at.
  expect(box!.paddingTop).toBe('0px')
  expect(box!.paddingLeft).toBe('0px')
  expect(box!.display).toBe('block')

  release()
})

test('the retired shell still centres its own text', async ({ page }) => {
  await page.route('**/manifest.json*',
    (route) => route.fulfill({ status: 410 }))
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return !!root?.querySelector('.boot-shell-retired')
  })

  const box = await shellBox(page)
  expect(box!.display).toBe('flex')
  expect(box!.paddingTop).toBe('24px')
  expect(box!.justifyContent).toBe('center')
})
