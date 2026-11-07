// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The boxed lists behind an access tier. An on-demand list
 * the public bytes carry shows once a `?show=` token unlocks
 * it. A list a signed-in reader's view serves shows after the
 * public ones, as a card of the same make, and a list arriving
 * both ways shows once.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as host from '@/host'
import { locale } from '@/i18n'
import { fetchStateByVersion } from '@/private-properties'
import { showTokens } from '@/show-filter'
import type { SignedSnapshot } from '@/archive'
import '@/components/dpp-badge-lists'

const USE = 'transpareo:intendedUse'

function wireRow(
  propertyID: string, access?: host.WireProperty['access']
): host.WireProperty {
  const value = [`${propertyID} one`, `${propertyID} two`]
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
  const lists = document.createElement('dpp-badge-lists')
  document.body.appendChild(lists)
  return lists
}

// The card titles in render order.
function titles(lists: Element): ReadonlyArray<string | null> {
  return [...lists.querySelectorAll('.dpp-list-card .dpp-section-title')]
    .map((t) => t.textContent)
}

beforeEach(() => {
  document.body.replaceChildren()
  locale.set('en')
  host.currentVersion.set(1)
  fetchStateByVersion.set({})
  showTokens.set([])
})

describe('an on-demand list of the public bytes', () => {
  beforeEach(() => publish([wireRow('care'), wireRow(USE, 'onDemand')]))

  it('shows no card without a ?show= token', () => {
    expect(titles(mount())).toEqual(['care'])
  })

  it('shows its card once a token unlocks it', () => {
    showTokens.set(['transpareo'])
    expect(titles(mount())).toEqual(['care', USE])
  })
})

describe('lists a signed-in reader\'s view serves', () => {
  beforeEach(() => publish([wireRow('care')]))

  it('show after the public ones, as the same card', () => {
    serve([wireRow(USE, 'legitimateInterest')])
    const lists = mount()
    expect(titles(lists)).toEqual(['care', USE])

    const items = [...lists.querySelectorAll('.dpp-list-card ul.dpp-list li')]
    expect(items.map((i) => i.textContent)).
      toEqual(['care one', 'care two', `${USE} one`, `${USE} two`])
  })

  it('stay with the version whose view served them', () => {
    serve([wireRow(USE, 'onDemand')], 2)
    expect(titles(mount())).toEqual(['care'])
  })

  // Unlocked, the public card stays where it stood; locked,
  // the card comes with the view's.
  it('show a list the public bytes carry as well once', () => {
    publish([wireRow(USE, 'onDemand'), wireRow('care')])
    serve([wireRow(USE, 'onDemand')])
    const lists = mount()
    expect(titles(lists)).toEqual(['care', USE])

    showTokens.set([USE])
    expect(titles(lists)).toEqual([USE, 'care'])
  })
})
