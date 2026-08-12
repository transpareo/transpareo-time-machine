// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Verifier mode mounts a <dpp-verifier> inside the renderer
 * element, and the widget reads its own `lang` attribute and
 * overwrites the module-global host locale as it sets up.
 * Without the attribute travelling with it, that overwrite is
 * a clobber: `<transpareo-time-machine lang="de" verifier>`
 * resolved to no host locale at all, so the documented `lang`
 * did nothing in that mode.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import '@/components/transpareo-time-machine'
import { config } from '@/config'
import { detectLocale, setHostLocale } from '@/i18n'

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

describe('lang in verifier mode', () => {
  it('reaches the nested widget', () => {
    mount({ lang: 'de', verifier: '' })
    expect(resolvedHostLocale()).toBe('de')
  })

  it('hands the attribute to the widget element itself', () => {
    const el = mount({ lang: 'de', verifier: '' })
    const widget = el.shadowRoot?.querySelector('dpp-verifier')
    expect(widget?.getAttribute('lang')).toBe('de')
  })

  it('leaves the widget unpinned when the host sets no lang', () => {
    const el = mount({ verifier: '' })
    const widget = el.shadowRoot?.querySelector('dpp-verifier')
    expect(widget?.hasAttribute('lang')).toBe(false)
    expect(resolvedHostLocale()).toBe('en')
  })
})

describe('lang without verifier mode', () => {
  it('stays set for the renderer subtree', () => {
    mount({ lang: 'de' })
    expect(resolvedHostLocale()).toBe('de')
  })
})
