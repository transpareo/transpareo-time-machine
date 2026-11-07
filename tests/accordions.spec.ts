// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The body-text accordion as a reader works it. Care,
 * disposal and repair are separate answers, so opening one
 * leaves the others as they stood; a section closes only
 * when its own header is clicked again. The open set is
 * the reader's, so it also survives the rebuild that a
 * locale switch runs under it.
 *
 * A toggled section is rebuilt, which takes the header the
 * reader just activated out of the document, so the
 * keyboard has to be put back on its replacement. The card
 * renders in a shadow root, where document.activeElement
 * reports the host.
 *
 * A long text a signed-in reader's view serves gets a
 * section of its own after the public ones, and a text
 * arriving both ways gets one section.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as host from '@/host'
import { locale } from '@/i18n'
import { fetchStateByVersion } from '@/private-properties'
import type { DppSnapshot, PropertyValue } from '@/types'
import '@/components/dpp-accordions'

function row(key: string, en: string, de: string): PropertyValue {
  return {
    key,
    name: { en, de },
    value: {
      type: 'longText',
      body: { en: `${key} body`, de: `${key} Text` }
    }
  }
}

const ROWS = [
  row('care', 'Care guide', 'Pflegehinweise'),
  row('disposal', 'Disposal', 'Entsorgung'),
  row('repair', 'Repair guidance', 'Reparaturhinweise')
]

// The rows on the active snapshot, plus an element that
// renders them. Unattached, so a caller can mount it where
// the test needs it.
function accordions(rows = ROWS): Element {
  host.currentVersion.set(1)
  host.snapshots.set({ 1: { properties: rows } as unknown as DppSnapshot })
  return document.createElement('dpp-accordions')
}

function mount(rows = ROWS): Element {
  const acc = accordions(rows)
  document.body.appendChild(acc)
  return acc
}

const LONG = 'a text behind an access tier, far too long for any tile'

// A row of a reader's view, too long for a tile unless
// `value` says otherwise.
function wireRow(
  propertyID: string, access: host.WireProperty['access'],
  value = `${propertyID}: ${LONG}`
): host.WireProperty {
  return { propertyID, name: { en: propertyID }, value, access }
}

// The view a signed-in reader is served for `version`, its
// rows adapted as the fetch hands them on.
function serve(rows: ReadonlyArray<host.WireProperty>, version = 1): void {
  const adapted = host.adaptPrivateRows(rows)
  fetchStateByVersion.set({ [version]: { status: 'ok', rows: adapted } })
}

// Keys of the sections carrying a state class, in render
// order: the open ones by default.
function sectionKeys(acc: Element, state = '.open'): string[] {
  const sel = `.dpp-accordion-item${state}`
  return [...acc.querySelectorAll<HTMLElement>(sel)]
    .map((item) => item.dataset.key!)
}

function click(acc: Element, key: string): void {
  acc.querySelector<HTMLButtonElement>(
    `[data-key="${key}"] .dpp-accordion-header`
  )!.click()
}

beforeEach(() => {
  document.body.replaceChildren()
  locale.set('en')
  fetchStateByVersion.set({})
})

describe('accordion sections', () => {
  it('opens the section whose header is clicked', () => {
    const acc = mount()
    click(acc, 'care')
    expect(sectionKeys(acc)).toEqual(['care'])
    expect(acc.querySelector('.dpp-accordion-body')?.textContent).
      toBe('care body')
  })

  it('leaves the sections already open alone', () => {
    const acc = mount()
    click(acc, 'care')
    click(acc, 'repair')
    expect(sectionKeys(acc)).toEqual(['care', 'repair'])
  })

  it('closes the section clicked a second time, only it', () => {
    const acc = mount()
    click(acc, 'care')
    click(acc, 'repair')
    click(acc, 'care')
    expect(sectionKeys(acc)).toEqual(['repair'])
  })

  it('tells assistive tech which sections are expanded', () => {
    const acc = mount()
    click(acc, 'disposal')
    const expanded = [...acc.querySelectorAll('.dpp-accordion-header')]
      .map((h) => h.getAttribute('aria-expanded'))
    expect(expanded).toEqual(['false', 'true', 'false'])
  })

  it('leaves the keyboard on the header that was activated', () => {
    const card = document.createElement('div')
    const shadow = card.attachShadow({ mode: 'open' })
    document.body.appendChild(card)
    shadow.appendChild(accordions())

    const header = (key: string): HTMLButtonElement =>
      shadow.querySelector(`[data-key="${key}"] .dpp-accordion-header`)!
    header('disposal').focus()
    header('disposal').click()

    expect(shadow.activeElement).toBe(header('disposal'))
    expect(header('disposal').getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps the open sections open across a locale switch', () => {
    const acc = mount()
    click(acc, 'care')
    click(acc, 'repair')
    locale.set('de')
    expect(sectionKeys(acc)).toEqual(['care', 'repair'])
    expect(acc.querySelector('.dpp-accordion-body')?.textContent).
      toBe('care Text')
  })

  // The entrance animation belongs to the click. A section
  // rebuilt from data is already open when the reader
  // meets it, so `opening` marks the clicked item alone.
  it('animates the section opened, and only that one', () => {
    const acc = mount()
    click(acc, 'care')
    click(acc, 'repair')
    expect(sectionKeys(acc, '.opening')).toEqual(['repair'])
  })

  it('opens a section at rest when the rows come back', () => {
    const acc = mount()
    click(acc, 'care')

    // What a version switch does to this element: the
    // snapshot under it changes and the list is rebuilt.
    host.snapshots.set({ 1: { properties: ROWS } as unknown as DppSnapshot })
    expect(sectionKeys(acc)).toEqual(['care'])
    expect(sectionKeys(acc, '.opening')).toEqual([])
  })
})

describe('long texts a signed-in reader\'s view serves', () => {
  it('get sections after the public ones, short rows none', () => {
    serve([
      wireRow('description', 'legitimateInterest'),
      wireRow('supplier', 'onDemand', 'Mill 7')
    ])
    expect(sectionKeys(mount(), '')).
      toEqual(['care', 'disposal', 'repair', 'description'])
  })

  it('open and close as the public sections do', () => {
    serve([wireRow('description', 'onDemand')])
    const acc = mount()
    click(acc, 'description')
    expect(sectionKeys(acc)).toEqual(['description'])
    expect(acc.querySelector('.dpp-accordion-body')?.textContent).
      toBe(`description: ${LONG}`)

    click(acc, 'description')
    expect(sectionKeys(acc)).toEqual([])
  })

  // The public bytes may carry an on-demand row the view
  // serves as well. Its section stays where it stood.
  it('show a text the public list carries as well once', () => {
    const gate = { namespace: 'repair', onDemand: true }
    const shared = { ...row('repair', 'Repair', 'Reparatur'), ...gate }
    serve([wireRow('repair', 'onDemand')])
    const acc = mount([shared, ...ROWS.slice(0, 2)])
    expect(sectionKeys(acc, '')).toEqual(['repair', 'care', 'disposal'])
  })

  it('stay with the version whose view served them', () => {
    serve([wireRow('description', 'legitimateInterest')], 2)
    expect(sectionKeys(mount(), '')).toEqual(['care', 'disposal', 'repair'])
  })
})
