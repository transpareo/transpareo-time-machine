// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The first paint waits for the picked locale's labels. The
 * bootstrap resolves the locale the moment the host reports
 * ready, but the ready flag the shell mounts on follows only
 * once that locale's label set is in, so a German visitor
 * never sees the English fallback swap out under them.
 */

import { describe, it, expect, vi } from 'vitest'
import * as host from '@/host'
import {
  locale, labelSet, labelsReady, setHostLocale, warmLabels,
} from '@/i18n'
import { englishLabels, loadLabels } from '@/i18n/labels'
import type { DppManifest } from '@/archive'

function declare(locales: string[]): void {
  host.manifest.set({ availableLocales: locales } as unknown as DppManifest)
}

describe('first paint locale', () => {
  it('holds the ready flag until the picked labels are in', async () => {
    setHostLocale('de')
    declare(['en', 'de'])
    expect(labelsReady()).toBe(false)

    host.loadState.set('ready')

    // The locale itself resolves synchronously, as before.
    expect(locale()).toBe('de')
    expect(labelsReady()).toBe(false)

    await vi.waitFor(() => expect(labelsReady()).toBe(true))
    expect(labelSet()).not.toBe(englishLabels)
    expect(labelSet()['locale.noMatches']).toBe('Keine Treffer')
  })

  it('warms the chunk the host pin names', async () => {
    setHostLocale('fr')
    const warmed = await warmLabels()

    // The pin decides which chunk is fetched ahead of the
    // manifest, and the bootstrap later reads that same set
    // straight from the cache.
    expect(warmed['locale.noMatches']).toBe('Aucun résultat')
    expect(await loadLabels('fr')).toBe(warmed)
  })
})
