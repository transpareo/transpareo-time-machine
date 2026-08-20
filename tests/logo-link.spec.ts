/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The `logo-href` chain, end to end in a browser: the
 * attribute on the host element reaches the rendered
 * brandbar as a real anchor around the themed logo. The
 * vitest specs cover the branch policy against a poked
 * config object; this one pins the wiring in between
 * (attribute parse, brandbar render, shadow tree) that a
 * unit test cannot see.
 *
 * The dev shell sets `logo-href="/"`, so the test reads
 * the configured value off the element rather than
 * hard-coding it.
 *
 * Runs against `npm run dev`.
 */
import { test, expect } from '@playwright/test'

test('the host logo-href renders the logo as a link', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' })

  await page.waitForFunction(() => {
    const root = document.querySelector('transpareo-time-machine')?.shadowRoot
    return root?.querySelector('.brand-logo') != null
  })

  const r = await page.evaluate(() => {
    const host = document.querySelector('transpareo-time-machine')!
    const logo = host.shadowRoot!.querySelector('.brand-logo')!
    return {
      configured: host.getAttribute('logo-href'),
      tag: logo.tagName,
      href: logo.getAttribute('href'),
      name: logo.getAttribute('aria-label'),
      focusable: logo.matches(':any-link')
    }
  })

  expect(r.configured).toBeTruthy()
  expect(r.tag).toBe('A')
  expect(r.href).toBe(r.configured)
  expect(r.focusable).toBe(true)

  // The artwork carries no text, so the anchor needs a
  // name of its own or it announces as its URL. Asserted
  // by shape, not by wording: the label is localized and
  // the browser under test picks the locale.
  expect(r.name).toBeTruthy()
  expect(r.name).not.toContain('/')
})
