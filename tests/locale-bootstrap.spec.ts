// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The one-shot effect that picks the SPA's locale. It waits
 * for the host to report ready, because the DPP's
 * availableLocales are not known before that, then resolves
 * once and leaves the picker in charge.
 *
 * Two things ride on the "once": a language the visitor
 * switches to mid-session must not be undone by any later
 * data change, and the resolution has to see the real
 * available list rather than the empty one it would read at
 * boot.
 */

import { describe, it, expect, vi } from 'vitest'
import * as host from '@/host'
import { locale, pickLocale } from '@/i18n'
import type { DppManifest } from '@/archive'

function declare(locales: string[]): void {
  host.manifest.set({ availableLocales: locales } as unknown as DppManifest)
}

describe('locale bootstrap', () => {
  it('resolves the stored pick once the host reports ready', () => {
    // A pick made on a page that set no `lang`, which is how
    // it is stored for the passport renderer.
    window.localStorage.setItem('tm.locale', 'fr')

    declare(['en', 'de', 'fr'])
    expect(locale()).toBe('en')

    host.loadState.set('ready')
    expect(locale()).toBe('fr')
  })

  it('leaves a later pick alone when the data changes again', () => {
    // With storage blocked, as a locked-down browser does,
    // re-resolving would answer from the browser preference
    // and overrule the visitor mid-session. Only running
    // once keeps their choice, so this is where the
    // bootstrap guard is the difference.
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    pickLocale('de')
    declare(['en', 'de', 'fr', 'it'])
    host.currentVersion.set(2)
    host.loadState.set('loading')
    host.loadState.set('ready')
    expect(locale()).toBe('de')
    vi.restoreAllMocks()
  })
})
