// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A document reference in the property list: the row's label
 * opens the document, whether the row came with the public
 * snapshot or with the restricted rows a signed-in reader gets.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as host from '@/host'
import type { DppSnapshot, PropertyValue } from '@/types'
import { fetchStateByVersion } from '@/private-properties'
import '@/components/dpp-properties'

const REPORT = 'https://cdn.example.com/media/demo/test_report.pdf'

const testReport: PropertyValue = {
  key: 'transpareo:testReport',
  name: { en: 'Test report', de: 'Prüfbericht' },
  value: { type: 'link', href: REPORT },
  namespace: 'transpareo:testReport'
}

function mount(): Element {
  const list = document.createElement('dpp-properties')
  document.body.appendChild(list)
  return list
}

function showSnapshot(properties: ReadonlyArray<PropertyValue>): void {
  const snapshot = { version: 1, properties } as unknown as DppSnapshot
  host.snapshots.set({ 1: snapshot })
}

beforeEach(() => {
  document.body.replaceChildren()
  host.currentVersion.set(1)
  showSnapshot([])
  fetchStateByVersion.set({})
})

describe('a restricted document row', () => {
  it('links its label to the document, under the restricted heading', () => {
    fetchStateByVersion.set({ 1: { status: 'ok', rows: [testReport] } })
    const list = mount()

    const heading = list.querySelector('.dpp-properties-heading')
    expect(heading?.textContent).toBe('Additional product data')
    const link = list.querySelector<HTMLAnchorElement>(
      '.dpp-property-row a.dpp-ext-link'
    )
    expect(link?.textContent?.trim()).toBe('Test report')
    expect(link?.getAttribute('href')).toBe(REPORT)
    expect(link?.target).toBe('_blank')
    expect(link?.rel).toBe('noopener noreferrer')
  })

  it('is a property row holding the shared link and nothing else', () => {
    fetchStateByVersion.set({ 1: { status: 'ok', rows: [testReport] } })
    const list = mount()

    const row = list.querySelector('.dpp-property-row')
    const link = row?.querySelector('.dpp-ext-link')
    expect(row?.children.length).toBe(1)
    expect(row?.firstElementChild).toBe(link)
    expect(link?.querySelector('svg')).toBeNull()
    expect(list.querySelector('[style]:not(.dpp-properties)')).toBeNull()
  })

  it('leaves a script URL as plain text', () => {
    const value = { type: 'link', href: 'javascript:alert(1)' } as const
    const row = { ...testReport, value }
    fetchStateByVersion.set({ 1: { status: 'ok', rows: [row] } })
    const list = mount()

    expect(list.querySelector('a')).toBeNull()
    const cell = list.querySelector('.dpp-property-row')
    expect(cell?.textContent).toBe('Test report')
  })
})

describe('a public document row', () => {
  it('links its label like a restricted one', () => {
    const { namespace: _, ...publicRow } = testReport
    showSnapshot([publicRow])
    const list = mount()

    const link = list.querySelector('.dpp-property-row a.dpp-ext-link')
    expect(link?.getAttribute('href')).toBe(REPORT)
    expect(list.querySelector('.dpp-properties-heading')).toBeNull()
  })
})
