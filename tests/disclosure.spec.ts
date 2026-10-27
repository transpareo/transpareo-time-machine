// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The folding section of a modal body. It stands open, and a
 * reader's fold outlives the element: the modals rebuild their
 * body on every render, and the rebuilt section keeps the fold
 * until the modal resets it on close.
 */

import { describe, it, expect } from 'vitest'
import { buildDisclosure, type Fold } from '../src/reactive/modal'

function summaryOf(details: HTMLDetailsElement): HTMLElement {
  return details.querySelector('summary')!
}

describe('buildDisclosure', () => {
  it('stands open with its label and chevron', () => {
    const fold: Fold = { folded: false }
    const details = buildDisclosure(fold, 'proof-disclosure', 'Checks')
    expect(details.open).toBe(true)
    expect(details.className).toBe('proof-disclosure')
    const summary = summaryOf(details)
    expect(summary.className).toBe('proof-disclosure-summary')
    expect(summary.querySelector('.proof-disclosure-label')!.textContent)
      .toBe('Checks')
    expect(summary.querySelector('.chevron')).not.toBeNull()
  })

  it('records the fold at the click, before any toggle event', () => {
    const fold: Fold = { folded: false }
    const details = buildDisclosure(fold, 'event-modal-disclosure', 'Tech')
    summaryOf(details).click()
    expect(fold.folded).toBe(true)
  })

  it('rebuilds folded once the reader folded it', () => {
    const fold: Fold = { folded: false }
    summaryOf(buildDisclosure(fold, 'proof-disclosure', 'Checks')).click()
    expect(buildDisclosure(fold, 'proof-disclosure', 'Checks').open)
      .toBe(false)
  })

  it('records an unfold the same way', () => {
    const fold: Fold = { folded: true }
    const details = buildDisclosure(fold, 'proof-disclosure', 'Checks')
    expect(details.open).toBe(false)
    summaryOf(details).click()
    expect(fold.folded).toBe(false)
  })
})
