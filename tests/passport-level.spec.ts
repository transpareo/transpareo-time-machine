/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Passport levels. A publisher can issue one passport for a
 * whole model or lot and a passport per unit beneath it. A
 * link to a unit that has no passport of its own is served
 * the passport one level up, in place; the renderer says so,
 * and a model or lot passport says its units carry their own.
 */

import { describe, expect, it } from 'vitest'
import { levelOf, requestedPassport, isWalkUp } from '../src/passport-level'

describe('levelOf', () => {
  it('reads the three levels', () => {
    expect(['model', 'lot', 'item'].map(levelOf))
      .toEqual(['model', 'lot', 'item'])
  })

  it('reads anything else as no level', () => {
    expect([undefined, '', 'Model', 'batch', 3].map(levelOf))
      .toEqual([undefined, undefined, undefined, undefined, undefined])
  })
})

describe('requestedPassport', () => {
  // The HTML shell says what the visitor asked for.
  it('prefers what the shell states', () => {
    const asked = requestedPassport(
      { level: 'item', id: 'SN-1' }, '/01/09524000059116/10/L1',
    )
    expect(asked).toEqual({ level: 'item', id: 'SN-1' })
  })

  // Without it, the GS1 Digital Link in the page path does.
  it('reads a serial from the path as an item', () => {
    const asked = requestedPassport({}, '/01/09524000059116/10/L1/21/SN-1')
    expect(asked).toEqual({ level: 'item', id: 'SN-1' })
  })

  it('reads a lot from the path as a lot', () => {
    const asked = requestedPassport({}, '/01/09524000059116/10/L%2F7')
    expect(asked).toEqual({ level: 'lot', id: 'L/7' })
  })

  it('asks for nothing on a path with no qualifier', () => {
    expect(requestedPassport({}, '/dpp/volturra/demo-2026-b001')).toBeNull()
    expect(requestedPassport({}, '/01/09524000059116')).toBeNull()
  })

  it('ignores a level the shell misspells', () => {
    expect(requestedPassport({ level: 'unit', id: 'x' }, '/')).toBeNull()
  })
})

describe('isWalkUp', () => {
  it('is a walk-up when the served level is coarser', () => {
    expect(isWalkUp('item', 'lot')).toBe(true)
    expect(isWalkUp('item', 'model')).toBe(true)
    expect(isWalkUp('lot', 'model')).toBe(true)
  })

  it('is no walk-up at the same or a finer level', () => {
    expect(isWalkUp('lot', 'lot')).toBe(false)
    expect(isWalkUp('model', 'item')).toBe(false)
    expect(isWalkUp('item', undefined)).toBe(false)
  })
})
