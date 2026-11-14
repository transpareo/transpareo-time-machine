// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The colours an event paints its dot, connector and pill in.
 *
 * A passport that left circulation marks that event in the
 * timeline's own ink, the colour the withdrawal band takes
 * from the card, so the dot and the band read as one state.
 * The verification red stays with proofs that failed and
 * with field recalls; a voided passport usually verifies.
 */
import { describe, it, expect } from 'vitest'
import { compile } from 'sass'
import { join } from 'node:path'
import { colorForEventType, paintEvent } from '@/event-colors'

const INK = 'var(--timeline-card-text, var(--font-color))'
const GROUND =
  'var(--timeline-card-background, var(--background-color))'
const PILL_TEXT = 'var(--timeline-event-text, #fff)'

const STYLES = join(import.meta.dirname, '../src/styles/')

function paint(eventType: string): CSSStyleDeclaration {
  const node = document.createElement('div')
  paintEvent(node, eventType)
  return node.style
}

describe('a withdrawn passport', () => {
  it.each(['voided', 'superseded'])('paints %s in the ink', (type) => {
    const style = paint(type)
    expect(style.getPropertyValue('--event-color')).toBe(INK)
    expect(style.getPropertyValue('--event-text-color')).toBe(GROUND)
  })

  it('never borrows the verification red', () => {
    expect(colorForEventType('voided')).not.toContain('verify-fail')
  })
})

describe('every other event', () => {
  it('keeps its own colour and the pill text token', () => {
    const style = paint('repair')
    const color = 'var(--timeline-event-repair)'
    expect(style.getPropertyValue('--event-color')).toBe(color)
    expect(style.getPropertyValue('--event-text-color')).toBe(PILL_TEXT)
  })

  it('keeps the red for a field recall', () => {
    expect(colorForEventType('recalled')).toBe('var(--color-verify-fail)')
  })
})

describe('the pill', () => {
  it('reads the text colour the event paints', () => {
    const css = compile(`${STYLES}dpp-page.scss`, {
      loadPaths: [STYLES]
    }).css
    const rule = css.slice(css.indexOf('.event-tag {'))
    const body = rule.slice(0, rule.indexOf('}'))
    expect(body).toContain('color: var(--event-text-color')
  })
})
