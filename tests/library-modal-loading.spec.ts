// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The component drawer while its library data is on the way:
 * the loading line turns a small ring beside its words.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { locale } from '@/i18n'
import type { CompositionEntry } from '@/types'

// A lookup that never settles holds the drawer in its
// loading state for as long as the case looks.
vi.mock('@/library-lookup', () => ({
  lookupLibrary: () => new Promise(() => {})
}))

const { selectedLibraryEntry } = await import(
  '@/components/dpp-library-modal'
)

const cotton = {
  name: { en: 'Organic cotton' },
  percent: 95,
  libraryRef: 'https://cdn.example.com/library/cotton.json'
} as unknown as CompositionEntry

beforeEach(() => {
  document.body.replaceChildren()
  locale.set('en')
  selectedLibraryEntry.set(null)
})

describe('the component drawer while its data loads', () => {
  it('turns a spinner beside the loading message', () => {
    document.body.appendChild(document.createElement('dpp-library-modal'))
    selectedLibraryEntry.set(cotton)

    const line = document.querySelector('.dpp-library-loading')!
    expect(line.textContent).toBe('Loading component library…')
    const ring = line.firstElementChild
    expect(ring?.matches('svg.icon-spinner.icon--fn')).toBe(true)
    expect(ring?.getAttribute('aria-hidden')).toBe('true')
  })
})
