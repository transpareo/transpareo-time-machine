// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The composition cards behind an access tier. An on-demand
 * composition the public bytes carry shows once a `?show=`
 * token unlocks it. A composition a signed-in reader's view
 * serves shows after the public ones, as a card of the same
 * make, and one arriving both ways shows once.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as host from '@/host'
import { locale } from '@/i18n'
import { fetchStateByVersion } from '@/private-properties'
import { showTokens } from '@/show-filter'
import type { SignedSnapshot } from '@/archive'
import '@/components/dpp-compositions'
import '@/components/dpp-composition-donut'

const FIBRE = 'transpareo:fibreComposition'

function wireRow(
  propertyID: string, access?: host.WireProperty['access']
): host.WireProperty {
  const value = [
    { name: { en: `${propertyID} A` }, value: 60 },
    { name: { en: `${propertyID} B` }, value: 40 }
  ]
  return { propertyID, name: { en: propertyID }, value, access }
}

// The public bytes of version 1, adapted as the boot does.
function publish(rows: ReadonlyArray<host.WireProperty>): void {
  const wire = { version: 1, product: { properties: rows } }
  const model = host.toRenderModel(wire as unknown as SignedSnapshot)
  host.snapshots.set({ 1: model })
}

// The view a signed-in reader is served for `version`.
function serve(rows: ReadonlyArray<host.WireProperty>, version = 1): void {
  const adapted = host.adaptPrivateRows(rows)
  fetchStateByVersion.set({ [version]: { status: 'ok', rows: adapted } })
}

function mount(): Element {
  const cards = document.createElement('dpp-compositions')
  document.body.appendChild(cards)
  return cards
}

// The card titles in render order.
function titles(cards: Element): ReadonlyArray<string | null> {
  return [...cards.querySelectorAll('.dpp-composition .dpp-section-title')]
    .map((t) => t.textContent)
}

beforeEach(() => {
  document.body.replaceChildren()
  locale.set('en')
  host.currentVersion.set(1)
  fetchStateByVersion.set({})
  showTokens.set([])
})

describe('an on-demand composition of the public bytes', () => {
  beforeEach(() => publish([wireRow('materials'), wireRow(FIBRE, 'onDemand')]))

  it('shows no card without a ?show= token', () => {
    expect(titles(mount())).toEqual(['materials'])
  })

  it('shows its card once a token unlocks it', () => {
    showTokens.set([FIBRE])
    expect(titles(mount())).toEqual(['materials', FIBRE])
  })
})

describe('compositions a signed-in reader\'s view serves', () => {
  beforeEach(() => publish([wireRow('materials')]))

  it('show after the public ones, as the same card', () => {
    serve([wireRow(FIBRE, 'legitimateInterest')])
    const cards = mount()
    expect(titles(cards)).toEqual(['materials', FIBRE])

    const served = cards.querySelectorAll('.dpp-composition')[1]
    const names = [...served.querySelectorAll('.dpp-comp-name')]
    expect(names.map((n) => n.textContent)).
      toEqual([`${FIBRE} A`, `${FIBRE} B`])
    expect(served.querySelector('.dpp-donut-center')?.textContent).
      toBe('100%')
  })

  it('stay with the version whose view served them', () => {
    serve([wireRow(FIBRE, 'onDemand')], 2)
    expect(titles(mount())).toEqual(['materials'])
  })

  // Unlocked, the public card stays where it stood; locked,
  // the card comes with the view's.
  it('show a composition the public bytes carry as well once', () => {
    publish([wireRow(FIBRE, 'onDemand'), wireRow('materials')])
    serve([wireRow(FIBRE, 'onDemand')])
    const cards = mount()
    expect(titles(cards)).toEqual(['materials', FIBRE])

    showTokens.set(['transpareo'])
    expect(titles(cards)).toEqual([FIBRE, 'materials'])
  })
})
