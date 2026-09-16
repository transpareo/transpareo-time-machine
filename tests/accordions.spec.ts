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
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as host from '@/host'
import { locale } from '@/i18n'
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
function accordions(): Element {
  host.currentVersion.set(1)
  host.snapshots.set({ 1: { properties: ROWS } as unknown as DppSnapshot })
  return document.createElement('dpp-accordions')
}

function mount(): Element {
  const acc = accordions()
  document.body.appendChild(acc)
  return acc
}

// Keys of the sections showing a body, in render order.
function openKeys(acc: Element): string[] {
  return [...acc.querySelectorAll<HTMLElement>('.dpp-accordion-item.open')]
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
})

describe('accordion sections', () => {
  it('opens the section whose header is clicked', () => {
    const acc = mount()
    click(acc, 'care')
    expect(openKeys(acc)).toEqual(['care'])
    expect(acc.querySelector('.dpp-accordion-body')?.textContent).
      toBe('care body')
  })

  it('leaves the sections already open alone', () => {
    const acc = mount()
    click(acc, 'care')
    click(acc, 'repair')
    expect(openKeys(acc)).toEqual(['care', 'repair'])
  })

  it('closes the section clicked a second time, only it', () => {
    const acc = mount()
    click(acc, 'care')
    click(acc, 'repair')
    click(acc, 'care')
    expect(openKeys(acc)).toEqual(['repair'])
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
    expect(openKeys(acc)).toEqual(['care', 'repair'])
    expect(acc.querySelector('.dpp-accordion-body')?.textContent).
      toBe('care Text')
  })
})
