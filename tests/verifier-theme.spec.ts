/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Theme contract of the standalone <dpp-verifier> widget.
 * Embedded on a publisher's own page there is no SPA
 * stylesheet defining the renderer's internal token layer,
 * so every visible token the widget reads resolves in three
 * steps: the publisher's branding token first, the SPA's
 * internal token second, the widget's own default last.
 *
 * Runs against `npm run dev`, whose /verifier.html shell
 * loads the widget alone (no app.css, no branding.css), the
 * same shape a host page gets from the dpp-verifier bundle.
 */
import { test, expect } from '@playwright/test'

// Colours as the engines report them, so an assertion
// reads as the token it stands for.
const ACCENT_DEFAULT = 'rgb(37, 93, 186)'
const BRAND_TOP = 'rgb(17, 34, 51)'
const BRAND_BOTTOM = 'rgb(68, 85, 102)'
const BRAND_TEXT = 'rgb(254, 220, 186)'
const BRAND_BG = 'rgb(16, 24, 32)'
const SURFACE_DEFAULT = 'rgb(255, 255, 255)'
const APP_ACCENT = 'rgb(1, 2, 3)'
const FONT_SM = '14px'
const FONT_BASE = '16px'

interface Probe {
  readonly hostFont: string
  readonly hostBg: string
  readonly submitFont: string
  readonly submitBg: string
  readonly submitText: string
  readonly submitRadius: string
  readonly submitSize: string
  readonly labelColor: string
  readonly labelSize: string
  readonly inputOutline: string
  readonly inputSize: string
}

// Every rgb() the gradient names, so "flat" (one repeated
// stop) and "two-stop" are told apart by value, not by the
// string shape each engine happens to serialize.
function stops(background: string): string[] {
  return background.match(/rgba?\([^)]*\)/g) ?? []
}

async function open(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/verifier.html')
  await page.waitForFunction(() => {
    const host = document.querySelector('dpp-verifier')
    return host?.shadowRoot?.querySelector('.verifier-submit') != null
  })
}

// Reads the widget's rendered tokens, optionally after
// declaring host-page custom properties the way a branding
// stylesheet (or the SPA's app.css) would.
async function probe(
  page: import('@playwright/test').Page,
  tokens?: Record<string, string>
): Promise<Probe> {
  return page.evaluate((decls: Record<string, string> | undefined) => {
    if (decls) {
      for (const [name, value] of Object.entries(decls)) {
        document.documentElement.style.setProperty(name, value)
      }
    }
    const host = document.querySelector('dpp-verifier')!
    const root = host.shadowRoot!
    const submit = getComputedStyle(root.querySelector('.verifier-submit')!)
    const label = getComputedStyle(root.querySelector('.verifier-label')!)
    const el = root.querySelector<HTMLInputElement>('.verifier-input')!
    el.focus()
    const input = getComputedStyle(el)
    return {
      hostFont: getComputedStyle(host).fontFamily,
      hostBg: getComputedStyle(host).backgroundColor,
      submitFont: submit.fontFamily,
      submitBg: submit.backgroundImage,
      submitText: submit.color,
      submitRadius: submit.borderRadius,
      submitSize: submit.fontSize,
      labelColor: label.color,
      labelSize: label.fontSize,
      inputOutline: input.outlineColor,
      inputSize: input.fontSize
    }
  }, tokens)
}

test('publisher branding tokens reach the widget', async ({ page }) => {
  await open(page)

  const branded = await probe(page, {
    '--font-family': "'Courier New', monospace",
    '--button-color-top': '#112233',
    '--button-color-bottom': '#445566',
    '--button-color-text': '#fedcba',
    '--background-color': '#101820',
    '--action-color': '#010203'
  })

  // The widget paints the theme's surface behind itself.
  expect(branded.hostBg).toBe(BRAND_BG)

  // The typeface reaches the widget and its submit label,
  // which a shadow root does not get from the host page's
  // own button reset.
  expect(branded.hostFont).toContain('Courier New')
  expect(branded.submitFont).toContain('Courier New')

  // The button surface is the publisher's button gradient,
  // its label the publisher's button text colour.
  expect(stops(branded.submitBg)).toEqual([BRAND_TOP, BRAND_BOTTOM])
  expect(branded.submitText).toBe(BRAND_TEXT)

  // The accent still drives the focus ring.
  expect(branded.inputOutline).toBe(APP_ACCENT)
})

test('with no branding, the widget stands on its own defaults', async ({
  page
}) => {
  await open(page)
  const bare = await probe(page)

  expect(bare.hostFont).toContain('system-ui')

  // With no theme the widget still states its own surface,
  // so its near-black copy never sits on a dark host ground.
  expect(bare.hostBg).toBe(SURFACE_DEFAULT)

  // No button pair: one accent, painted flat.
  expect(stops(bare.submitBg)).toEqual([ACCENT_DEFAULT, ACCENT_DEFAULT])
  expect(bare.inputOutline).toBe(ACCENT_DEFAULT)

  // The label sits at the body step so it reads with the
  // page copy around the widget; input and submit keep the
  // renderer's small step.
  expect(bare.labelSize).toBe(FONT_BASE)
  expect(bare.inputSize).toBe(FONT_SM)
  expect(bare.submitSize).toBe(FONT_SM)
})

test('the SPA token layer wins over the widget defaults', async ({ page }) => {
  await open(page)

  // What app.css declares inside the full renderer. The
  // widget mounts there as a nested shadow root, so these
  // must keep resolving exactly as they do today.
  const inApp = await probe(page, {
    '--font-sans': "'Courier New', monospace",
    '--font-base': '17px',
    '--font-sm': '20px',
    '--action-color': '#010203',
    '--color-muted': '#0a0b0c',
    '--radius-sm': '6px'
  })

  expect(inApp.hostFont).toContain('Courier New')
  expect(stops(inApp.submitBg)).toEqual([APP_ACCENT, APP_ACCENT])
  expect(inApp.labelColor).toBe('rgb(10, 11, 12)')
  expect(inApp.submitRadius).toBe('6px')

  // The label follows the app's body step (--font-base in
  // app.css); the form controls follow the small step.
  expect(inApp.labelSize).toBe('17px')
  expect(inApp.submitSize).toBe('20px')
})
