// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Rows behind an access tier in the property list. An
 * on-demand row the public bytes carry shows once the URL's
 * `?show=` token unlocks it. The rows a signed-in reader's
 * view serves show at once under "Additional product data",
 * on-demand and legitimate-interest alike, a description or
 * facility behind a tier among them, and a row arriving both
 * ways shows once, also where the two sides sort it apart: a
 * short value between two long texts reads as one of them.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as host from '@/host'
import type { DppSnapshot, PropertyValue } from '@/types'
import type { SignedSnapshot } from '@/archive'
import { fetchStateByVersion } from '@/private-properties'
import { showTokens } from '@/show-filter'
import '@/components/dpp-properties'
import '@/components/dpp-accordions'

const RECYCLED = 'transpareo:recycledShare'

function wireRow(
  propertyID: string, label: string, access: host.WireProperty['access'],
  value: unknown = '12 %'
): host.WireProperty {
  return { propertyID, name: { en: label }, value, access }
}

function mount(): Element {
  const list = document.createElement('dpp-properties')
  document.body.appendChild(list)
  return list
}

// The public bytes of version 1, adapted as the boot does.
function publish(rows: ReadonlyArray<host.WireProperty>): void {
  const wire = { version: 1, product: { properties: rows } }
  const model = host.toRenderModel(wire as unknown as SignedSnapshot)
  showSnapshot(model.properties)
}

function showSnapshot(properties: ReadonlyArray<PropertyValue>): void {
  const snapshot = { version: 1, properties } as unknown as DppSnapshot
  host.snapshots.set({ 1: snapshot })
}

function serve(rows: ReadonlyArray<host.WireProperty>): void {
  const adapted = host.adaptPrivateRows(rows)
  fetchStateByVersion.set({ 1: { status: 'ok', rows: adapted } })
}

function labels(list: Element): ReadonlyArray<string | null> {
  return [...list.querySelectorAll('.dpp-property-label')]
    .map((l) => l.textContent)
}

// The list in document order: headings and row labels.
function outline(list: Element): ReadonlyArray<string | null> {
  const nodes = list.querySelectorAll(
    '.dpp-properties-heading, .dpp-property-label'
  )
  return [...nodes].map((n) => n.textContent)
}

beforeEach(() => {
  document.body.replaceChildren()
  host.currentVersion.set(1)
  showSnapshot([])
  fetchStateByVersion.set({})
  showTokens.set([])
})

describe('an on-demand row of the public bytes', () => {
  beforeEach(() => {
    publish([wireRow(RECYCLED, 'Recycled share', 'onDemand')])
  })

  it('stays hidden without a ?show= token', () => {
    expect(labels(mount())).toEqual([])
  })

  it('shows once a ?show= token unlocks it', () => {
    showTokens.set(['transpareo'])
    expect(labels(mount())).toEqual(['Recycled share'])
  })

  it('shows once when the reader\'s view serves it too', () => {
    showTokens.set(['transpareo'])
    serve([wireRow(RECYCLED, 'Recycled share', 'onDemand')])

    expect(outline(mount()))
      .toEqual(['Additional product data', 'Recycled share'])
  })
})

describe('the rows a signed-in reader\'s view serves', () => {
  it('shows on-demand rows at once, beside legitimate-interest ones', () => {
    serve([
      wireRow(RECYCLED, 'Recycled share', 'onDemand'),
      wireRow('transpareo:supplier', 'Supplier', 'legitimateInterest')
    ])

    expect(outline(mount()))
      .toEqual(['Additional product data', 'Recycled share', 'Supplier'])
  })

  // Neither slot of the product block can name a tier, so a
  // restricted description or facility comes as a row of it.
  it('shows a description and a facility behind a tier as rows', () => {
    const description = [{ '@value': 'Organic cotton', '@language': 'en' }]
    serve([
      wireRow('description', 'Description', 'onDemand', description),
      wireRow('facility', 'Facility', 'legitimateInterest', 7612345000039)
    ])

    const list = mount()
    expect(labels(list)).toEqual(['Description', 'Facility'])
    const values = list.querySelectorAll('.dpp-property-value')
    expect(values[0].textContent).toBe('Organic cotton')
  })
})

// Each side sorts its rows alone, and a short value between
// two long texts reads as one of them. One row can then be a
// short value on one side and a long text on the other.
describe('a row the two sides sort apart', () => {
  const LONG = 'a text behind an access tier, far too long for any tile'
  const text = (id: string, access?: host.WireProperty['access']) =>
    wireRow(id, id, access, `${id}: ${LONG}`)

  // Where the row shows: the table's labels, then the
  // fold-out panels' keys.
  function places(): ReadonlyArray<string | null> {
    const list = mount()
    const panels = document.createElement('dpp-accordions')
    document.body.appendChild(panels)
    const keys = [...panels.querySelectorAll<HTMLElement>('[data-key]')]
      .map((p) => `panel ${p.dataset.key}`)
    return [...labels(list), ...keys]
  }

  beforeEach(() => showTokens.set(['transpareo']))

  it('shows once as the panel the reader\'s view makes of it', () => {
    publish([wireRow(RECYCLED, 'Recycled share', 'onDemand')])
    serve([
      text('care', 'legitimateInterest'),
      wireRow(RECYCLED, 'Recycled share', 'onDemand'),
      text('repair', 'legitimateInterest')
    ])

    expect(places()).
      toEqual(['panel care', `panel ${RECYCLED}`, 'panel repair'])
  })

  it('shows once as the panel the public bytes make of it', () => {
    publish([
      text('care'),
      wireRow(RECYCLED, 'Recycled share', 'onDemand'),
      text('repair')
    ])
    serve([wireRow(RECYCLED, 'Recycled share', 'onDemand')])

    expect(places()).
      toEqual(['panel care', `panel ${RECYCLED}`, 'panel repair'])
  })

  it('shows once in the table while no token unlocks the panel', () => {
    showTokens.set([])
    publish([
      text('care'),
      wireRow(RECYCLED, 'Recycled share', 'onDemand'),
      text('repair')
    ])
    serve([wireRow(RECYCLED, 'Recycled share', 'onDemand')])

    expect(places()).toEqual(['Recycled share', 'panel care', 'panel repair'])
  })
})
