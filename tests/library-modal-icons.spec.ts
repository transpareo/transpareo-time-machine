// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A library entry's property rows take their icon from the
 * publisher's external icon map, joined on the row's `key`
 * exactly as the passport's own rows are. The entry itself
 * names no icon.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { locale } from '@/i18n'
import { initConfigFromElement } from '@/config'
import { loadContentIconMap } from '@/icons'
import type { ComponentLookup, CompositionEntry } from '@/types'

const lookup: ComponentLookup = {
  id: 'component/cotton',
  properties: [
    {
      key: 'origin',
      label: { en: 'Origin' },
      value: { type: 'text', value: { en: 'Portugal' } }
    },
    {
      key: 'function',
      label: { en: 'Function' },
      value: { type: 'text', value: { en: 'Primary fibre' } }
    }
  ]
}

vi.mock('@/library-lookup', () => ({
  lookupLibrary: () => Promise.resolve(lookup)
}))

const { selectedLibraryEntry } = await import(
  '@/components/dpp-library-modal'
)

const cotton = {
  name: { en: 'Organic cotton' },
  percent: 95,
  libraryRef: 'https://cdn.example.com/library/cotton.json'
} as unknown as CompositionEntry

// A fetch that answers the map only once `release` runs, so
// a case can open the drawer before the map has arrived.
function serveMap(map: Record<string, string>): () => void {
  let release = (): void => {}
  const body = new Promise<Record<string, string>>((resolve) => {
    release = () => resolve(map)
  })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => body
  }))
  return release
}

function openDrawer(): void {
  document.body.appendChild(document.createElement('dpp-library-modal'))
  selectedLibraryEntry.set(cotton)
}

function labelOf(text: string): Element {
  const labels = document.querySelectorAll('.dpp-library-row-label')
  const label = [...labels].find((l) => l.textContent?.trim() === text)
  if (!label) throw new Error(`no row labelled ${text}`)
  return label
}

beforeEach(() => {
  document.body.replaceChildren()
  locale.set('en')
  selectedLibraryEntry.set(null)
  const host = document.createElement('div')
  host.setAttribute('icon-map-src', '/p/icon-map.json')
  initConfigFromElement(host)
})

afterEach(() => vi.unstubAllGlobals())

describe('icons on the component drawer rows', () => {
  it('puts the mapped icon before a row label', async () => {
    serveMap({ origin: 'globe' })()
    loadContentIconMap()
    openDrawer()

    await vi.waitFor(() =>
      expect(labelOf('Origin').querySelector('svg.icon-globe')).not.toBeNull())
    const glyph = labelOf('Origin').firstElementChild
    expect(glyph?.querySelector('use')?.getAttribute('href')).toBe('#icon-globe')
    expect(glyph?.getAttribute('aria-hidden')).toBe('true')
  })

  it('leaves a row the map does not name without an icon', async () => {
    serveMap({ origin: 'globe' })()
    loadContentIconMap()
    openDrawer()

    await vi.waitFor(() =>
      expect(labelOf('Origin').querySelector('svg')).not.toBeNull())
    expect(labelOf('Function').querySelector('svg')).toBeNull()
  })

  it('adds the icon once a late map arrives', async () => {
    const release = serveMap({ function: 'cog' })
    loadContentIconMap()
    openDrawer()

    await vi.waitFor(() => labelOf('Function'))
    expect(labelOf('Function').querySelector('svg')).toBeNull()

    release()
    await vi.waitFor(() =>
      expect(labelOf('Function').querySelector('svg.icon-cog')).not.toBeNull())
  })
})
