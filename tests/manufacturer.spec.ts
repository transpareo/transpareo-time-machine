// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The manufacturer organization names the manufacturer by its
 * LEI, GLN or DID (`operatorId`), which the address strip shows
 * beside the address. A manufacturer behind an access tier is
 * left out of the public snapshot and takes the strip from a
 * signed-in reader's view.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  toRenderModel, adaptPrivateManufacturer, currentVersion, snapshots
} from '../src/host'
import { fetchStateByVersion } from '../src/private-properties'
import type { SignedSnapshot } from '../src/archive'
import '../src/components/dpp-manufacturer'

function snapshot(manufacturer?: Record<string, unknown>): SignedSnapshot {
  return {
    version: 1,
    publishedAt: '2026-01-01T00:00:00Z',
    dppStatus: 'inUse',
    issuer: { '@type': 'Organization', name: 'I', did: 'did:web:i' },
    platform: { '@type': 'Organization', name: 'P', did: 'did:web:p' },
    product: {
      '@type': 'Product', name: { en: 'X' }, brand: 'B',
      properties: [], manufacturer
    },
    proof: []
  } as unknown as SignedSnapshot
}

describe('toRenderModel: manufacturer identifier', () => {
  it('carries the operator id', () => {
    const wire = { name: 'Hans Tester GmbH', operatorId: '7612345000039' }
    const m = toRenderModel(snapshot(wire)).product.manufacturer
    expect(m.identifier).toBe('7612345000039')
  })

  it('leaves the identifier empty when the wire carries none', () => {
    const m = toRenderModel(snapshot({ name: 'N' })).product.manufacturer
    expect(m.identifier).toBe('')
  })
})

describe('<dpp-manufacturer>', () => {
  const VOLTWERK = {
    name: 'Voltwerk AG', city: 'Zug', propertyID: '9',
    access: 'legitimateInterest' as const
  }

  function show(manufacturer?: Record<string, unknown>): HTMLElement {
    currentVersion.set(1)
    snapshots.set({ 1: toRenderModel(snapshot(manufacturer)) })
    const strip = document.createElement('dpp-manufacturer')
    document.body.appendChild(strip)
    return strip.querySelector<HTMLElement>('.dpp-manufacturer')!
  }

  function serve(manufacturer: typeof VOLTWERK | undefined): void {
    const served = adaptPrivateManufacturer(manufacturer)
    const extra = served ? { manufacturer: served } : {}
    fetchStateByVersion.set({ 1: { status: 'ok', rows: [], ...extra } })
  }

  beforeEach(() => {
    document.body.replaceChildren()
    fetchStateByVersion.set({})
  })

  it('stays hidden while no one names a manufacturer', () => {
    expect(show().style.display).toBe('none')
  })

  it('shows the manufacturer a reader\'s view names behind a tier', () => {
    serve(VOLTWERK)
    const strip = show()

    expect(strip.style.display).toBe('')
    expect(strip.textContent).toBe('Voltwerk AGZug')
  })

  it('keeps the public manufacturer when the view names none', () => {
    serve(undefined)
    const strip = show({ name: 'Hans Tester GmbH' })

    expect(strip.textContent).toBe('Hans Tester GmbH')
  })
})
