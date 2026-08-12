// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Verifier mode mounts a <dpp-verifier> inside the renderer
 * element, and the widget resolves its own markup and
 * overwrites the module-global host locale as it sets up.
 * Without the locale travelling with it, that overwrite is a
 * clobber: `<transpareo-time-machine lang="de" verifier>`
 * resolved to no host locale at all, so the documented
 * attribute did nothing in that mode.
 *
 * It travels already resolved, because `locale="inherit"`
 * asks about the page around the element and the widget sits
 * inside a shadow root, where it can see none of it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import '@/components/transpareo-time-machine'
import { config } from '@/config'
import { detectLocale, locale, setHostLocale } from '@/i18n'

// What the host locale resolves to right now: 'de' only if
// some element in the tree left it set to German.
function resolvedHostLocale(): string {
  return detectLocale(['en', 'de'])
}

function mount(attrs: Record<string, string>): Element {
  const el = document.createElement('transpareo-time-machine')
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.appendChild(el)
  return el
}

// Mounting the element asks for the decorative content
// sprite (`/icons.svg` by default). Nothing here reads it,
// but a request still in flight when the environment tears
// down aborts noisily, so it is answered locally.
vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}')))

afterEach(() => {
  document.body.replaceChildren()
  setHostLocale(null)

  // initConfigFromElement merges and never clears, so an
  // element that set `verifier` would leave every later mount
  // in verifier mode.
  delete (config as { verifier?: boolean }).verifier
})

describe('the locale in verifier mode', () => {
  it('reaches the nested widget', () => {
    mount({ lang: 'de', verifier: '' })
    expect(resolvedHostLocale()).toBe('de')
  })

  it('hands the resolved locale to the widget element', () => {
    const el = mount({ lang: 'de', verifier: '' })
    const widget = el.shadowRoot?.querySelector('dpp-verifier')
    expect(widget?.getAttribute('locale')).toBe('de')
  })

  it('carries a locale attribute the same way', () => {
    mount({ locale: 'de', verifier: '' })
    expect(resolvedHostLocale()).toBe('de')
  })

  it('resolves inherit before the shadow boundary hides it', () => {
    // The widget could not answer this for itself: closest()
    // stops at its shadow root, so the page's lang is out of
    // reach from in there.
    document.documentElement.setAttribute('lang', 'de')
    try {
      const el = mount({ locale: 'inherit', verifier: '' })
      const widget = el.shadowRoot?.querySelector('dpp-verifier')
      expect(widget?.getAttribute('locale')).toBe('de')
      expect(resolvedHostLocale()).toBe('de')
    } finally {
      document.documentElement.removeAttribute('lang')
    }
  })

  it('says auto when the host names no locale', () => {
    const el = mount({ verifier: '' })
    const widget = el.shadowRoot?.querySelector('dpp-verifier')
    expect(widget?.getAttribute('locale')).toBe('auto')
    expect(resolvedHostLocale()).toBe('en')
  })
})

describe('the locale without verifier mode', () => {
  it('stays set for the renderer subtree', () => {
    mount({ lang: 'de' })
    expect(resolvedHostLocale()).toBe('de')
  })

  it('takes a locale attribute on the renderer itself', () => {
    mount({ locale: 'de' })
    expect(resolvedHostLocale()).toBe('de')
  })

  it('lets auto on the renderer overrule a templated lang', () => {
    mount({ locale: 'auto', lang: 'de' })
    expect(resolvedHostLocale()).toBe('en')
  })

  it('inherits the surrounding language', () => {
    document.documentElement.setAttribute('lang', 'de')
    try {
      mount({ locale: 'inherit' })
      expect(resolvedHostLocale()).toBe('de')
    } finally {
      document.documentElement.removeAttribute('lang')
    }
  })
})

// The standalone widget resolves the same markup, and has no
// DPP locales to fall back on, so its whole UI hangs off it.
describe('the locale on a standalone widget', () => {
  it('renders the widget in the locale its markup names', async () => {
    const widget = document.createElement('dpp-verifier')
    widget.setAttribute('locale', 'de')
    document.body.appendChild(widget)

    expect(locale()).toBe('de')
    await vi.waitFor(() => {
      const submit = widget.shadowRoot?.querySelector('.verifier-submit')
      expect(submit?.textContent).toBe('Prüfen')
    })
  })

  it('detects when its markup names none', () => {
    document.body.appendChild(document.createElement('dpp-verifier'))
    expect(locale()).toBe('en')
  })
})
