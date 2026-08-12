// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The footer locale picker as a visitor reads it: one row
 * per available locale, leading with what their current
 * locale calls that language and keeping the native name as
 * a hint, sorted by the leading name.
 *
 * This is where the casing rule has to land. localizedName
 * is unit-tested on its own, but the row is what ships, and
 * it composes two sources - the Intl display name and the
 * native-name table - either of which can supply the label.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as host from '@/host'
import { locale } from '@/i18n'
import type { DppManifest } from '@/archive'
import type { DppSnapshot } from '@/types'
import '@/components/dpp-footer'

// Mount the footer and open the picker: the menu fills its
// list only while open, so a closed picker has no rows to
// read.
function mount(locales: string[], viewer: string): Element {
  locale.set(viewer)
  host.manifest.set({ availableLocales: locales } as unknown as DppManifest)
  const footer = document.createElement('dpp-footer')
  document.body.appendChild(footer)
  footer.querySelector<HTMLButtonElement>('.locale-switch')?.click()
  return footer
}

// Each row as the visitor reads it: the leading name, then
// the native hint where one is shown.
function rows(footer: Element): string[][] {
  return [...footer.querySelectorAll('.locale-list button')].map((b) =>
    [...b.children].map((s) => s.textContent ?? ''))
}

beforeEach(() => {
  document.body.replaceChildren()
  host.currentVersion.set(1)
  host.snapshots.set({ 1: {} as unknown as DppSnapshot })
})

describe('locale picker rows', () => {
  it('leads with the viewer name and hints the native one', () => {
    const footer = mount(['en', 'de', 'fr'], 'en')
    expect(rows(footer)).toEqual([
      ['English'], ['French', 'Français'], ['German', 'Deutsch'],
    ])
  })

  it('drops the hint on the row naming the viewer locale', () => {
    // "Deutsch" beside "Deutsch" is noise, so that row keeps
    // the native name alone.
    const footer = mount(['en', 'de'], 'de')
    expect(rows(footer)).toEqual([['Deutsch'], ['Englisch', 'English']])
  })

  it('capitalizes the leading name for a lowercase locale', () => {
    // The end of the chain the casing rule exists for: an
    // Italian viewer must not read "rumeno" in a menu.
    const footer = mount(['it', 'ro', 'en'], 'it')
    expect(rows(footer)).toEqual([
      ['Inglese', 'English'], ['Italiano'], ['Rumeno', 'Română'],
    ])
  })

  it('sorts rows by the leading name, not the code', () => {
    const footer = mount(['de', 'en', 'es'], 'en')
    expect(rows(footer).map((r) => r[0])).
      toEqual(['English', 'German', 'Spanish'])
  })

  it('marks the active row for assistive tech', () => {
    const footer = mount(['en', 'de'], 'de')
    const active = footer.querySelector('button[aria-selected="true"]')
    expect(active?.textContent).toBe('Deutsch')
    expect(active?.className).toBe('active')
  })
})

describe('locale picker rows: locales we ship no name for', () => {
  it('names a regional tag from the platform, with no hint', () => {
    // No NATIVE_NAMES entry for pt-BR, but Intl can name it.
    // The hint would be the bare code, which reads as data
    // leaking into the UI rather than as a language.
    const footer = mount(['en', 'pt-BR'], 'en')
    expect(rows(footer)).toEqual([['Brazilian Portuguese'], ['English']])
  })

  it('renders native names when the platform has no Intl data', () => {
    // Intl.DisplayNames landed in Safari 14.1 and Firefox 86,
    // and an engine without it must not cost the picker its
    // rows. The names we ship by hand are the floor: worst
    // case every row reads as it did before the hint existed.
    // A viewer locale unused above, since the lookup is
    // cached per viewer.
    const real = Intl.DisplayNames
    try {
      (Intl as { DisplayNames?: unknown }).DisplayNames = undefined
      const footer = mount(['sv', 'de'], 'sv')
      expect(rows(footer)).toEqual([['Deutsch'], ['Svenska']])
    } finally {
      (Intl as { DisplayNames?: unknown }).DisplayNames = real
    }
  })

  it('falls back to the bare code when nothing can name it', () => {
    // A manifest may declare anything. The row is then the
    // uppercased code rather than an empty label.
    const footer = mount(['en', 'q-zz'], 'en')
    expect(rows(footer).map((r) => r[0])).toContain('Q-ZZ')
  })

  it('survives a locale code that names an Object method', () => {
    // availableLocales is untrusted, and a plain lookup table
    // answers "toString" with a function, which the name
    // pipeline then calls string methods on. That threw and
    // took the whole picker down with it.
    const footer = mount(['en', 'toString'], 'en')
    expect(rows(footer).map((r) => r[0])).toEqual(['English', 'TOSTRING'])
  })
})
