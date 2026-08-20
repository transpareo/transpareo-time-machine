/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The footer language picker in a real browser. Everything
 * else about it is unit-tested against Node's ICU, which is
 * not the data a visitor's engine ships: this is the one
 * check that the names come out right where it counts.
 *
 * The viewer is French because French writes language names
 * lowercase in a sentence, which is the only form
 * Intl.DisplayNames offers. Without the list-context casing
 * these rows read "allemand" and "anglais".
 *
 * The type-ahead filter is here too: it appears only above
 * the row threshold, which no fixture crosses, so the second
 * case serves a manifest that declares enough locales.
 */
import { test, expect } from '@playwright/test'

test.use({ locale: 'fr-FR' })

test('picker names are capitalized and hinted', async ({
  page,
}) => {
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })

  // The element mounts the SPA into its shadow root once the
  // host reports ready; the picker is part of that tree.
  await page.waitForFunction(() => {
    const el = document.querySelector('transpareo-time-machine')
    return !!(el?.shadowRoot?.querySelector('.stage'))
  })

  const toggle = page.locator('.locale-switch')
  await expect(toggle).toBeVisible()
  await toggle.click()

  // Rows render only while the menu is open. Each is the
  // leading name plus, where one is shown, the native hint.
  const rows = await page.locator('.locale-list button').evaluateAll(
    (buttons) => buttons.map(
      (b) => [...b.children].map((s) => s.textContent ?? ''),
    ),
  )

  // German and English named in French, capitalized for the
  // list; French itself keeps its native name alone, the
  // localized form being an echo of it.
  expect(rows).toEqual([
    ['Allemand', 'Deutsch'],
    ['Anglais', 'English'],
    ['Français'],
  ])

  const lowercase = rows.filter(([name]) => {
    const [first] = name
    return first !== first.toLocaleUpperCase('fr')
  })
  expect(lowercase).toEqual([])
})

test('the filter field carries an id, not autofill', async ({ page }) => {
  const base = 'http://localhost:5173/nordic-wear-tshirt/dpp/demo-2026-t001'
  await page.route(`${base}/manifest.json`, async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    body.availableLocales = [
      'en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da',
    ]
    await route.fulfill({ json: body })
  })

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.locator('.locale-switch').click()

  const filter = page.locator('.locale-filter')
  await expect(filter).toBeVisible()

  // A control with neither id nor name draws a console
  // warning and is a target for autofill from unrelated
  // history, which a filter box has no business offering.
  await expect(filter).toHaveAttribute('id', 'locale-filter')
  await expect(filter).toHaveAttribute('autocomplete', 'off')

  // The id belongs to the shadow root, not to the page
  // around it, so a host page keeps its own ids.
  const leaked = await page.evaluate(
    () => document.getElementById('locale-filter') !== null,
  )
  expect(leaked).toBe(false)
})
