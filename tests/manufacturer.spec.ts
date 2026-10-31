/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The manufacturer organization names the manufacturer by its
 * LEI, GLN or DID (`operatorId`), which the address strip shows
 * beside the address.
 */

import { describe, expect, it } from 'vitest'
import { toRenderModel } from '../src/host'
import type { SignedSnapshot } from '../src/archive'

function snapshot(manufacturer: Record<string, unknown>): SignedSnapshot {
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
