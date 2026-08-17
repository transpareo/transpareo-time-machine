/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The fixture schema's publication rules: single-snapshot
 * fixtures carry exactly one snapshot and no events, and
 * an unsigned fixture (proof_suite: none) exists only in
 * that shape - an unsigned manifest set is not a
 * supported publication.
 */
import { describe, it, expect } from 'vitest'
import { FixtureSchema } from '../scripts/seed/schema.ts'

function snap(version: number): Record<string, unknown> {
  return {
    version,
    published_at: '2026-01-01T00:00:00Z',
    status: 'in_use',
    composition: [{ name: 'Clay', percent: 100, color: '#B4653F' }]
  }
}

function base(): Record<string, unknown> {
  return {
    schema_version: 1,
    id: 'demo-fixture',
    code: 'demo-1',
    status: 'in_use',
    published_at: '2026-01-01T00:00:00Z',
    verified: false,
    issuer: { name: 'A', did: 'did:web:a.example' },
    platform: { name: 'P', did: 'did:web:p.example' },
    available_locales: ['en'],
    product: {
      name: 'Demo',
      brand: 'A',
      description: 'D',
      compositions: [{
        key: 'material',
        title: 'Material',
        entries: [{ name: 'Clay', percent: 100, color: '#B4653F' }]
      }],
      metrics: [],
      lists: [],
      accordions: [],
      manufacturer: {
        name: 'A', street: 'S 1', city: 'C', country: 'Portugal'
      }
    },
    snapshots: [snap(1)],
    events: []
  }
}

function issuesOf(doc: Record<string, unknown>): string[] {
  const r = FixtureSchema.safeParse(doc)
  if (r.success) return []
  return r.error.issues.map((i) => i.path.join('.'))
}

describe('fixture schema: publication shapes', () => {
  it('accepts the default signed manifest fixture', () => {
    expect(issuesOf(base())).toEqual([])
  })

  it('accepts an unsigned single-snapshot fixture', () => {
    const doc = {
      ...base(), publication: 'single-snapshot', proof_suite: 'none'
    }
    expect(issuesOf(doc)).toEqual([])
  })

  it('rejects a single-snapshot fixture with two snapshots', () => {
    const doc = {
      ...base(),
      publication: 'single-snapshot',
      snapshots: [snap(1), snap(2)]
    }
    expect(issuesOf(doc)).toContain('snapshots')
  })

  it('rejects a single-snapshot fixture with events', () => {
    const doc = {
      ...base(),
      publication: 'single-snapshot',
      events: [{
        id: 'e1',
        event_type: 'published',
        occurred_at: '2026-01-01T00:00:00Z',
        actor_label: 'A'
      }]
    }
    expect(issuesOf(doc)).toContain('events')
  })

  it('rejects an unsigned manifest publication', () => {
    const doc = { ...base(), proof_suite: 'none' }
    expect(issuesOf(doc)).toContain('proof_suite')
  })
})
