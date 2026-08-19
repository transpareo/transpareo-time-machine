/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Coverage for computeAxis(), which resolves the time
 * axis under <dpp-timeline>. Two properties matter and
 * neither is visible from the markup: the step follows
 * the width it is handed, so the same span resolves
 * coarser on a phone than on a desktop instead of
 * stacking its marks, and a mark never spells a day.
 * The dates below are built with the local-time
 * constructor because the walk aligns on local calendar
 * boundaries.
 */
import { describe, expect, it } from 'vitest'
import { computeAxis, MIN_PITCH } from '../src/components/timeline/ticks'

// The band an expanded desktop strip gives the events:
// canvas minus the padding and the card insets.
const WIDE = 986
const NARROW = 60

const at = (y: number, m: number, d: number): number =>
  new Date(y, m, d).getTime()

const texts = (a: { marks: { text: string }[] }): string[] =>
  a.marks.map((m) => m.text)

describe('computeAxis', () => {
  const autumn = { min: at(2025, 8, 18), max: at(2025, 10, 6) }

  it('names the months of a season-long span', () => {
    const axis = computeAxis(autumn.min, autumn.max, WIDE, 'en-US')
    expect(axis.granularity).toBe('month')
    expect(texts(axis)).toEqual(['Sep', 'Oct', 'Nov'])
  })

  it('starts at the month the first event falls inside', () => {
    const axis = computeAxis(autumn.min, autumn.max, WIDE, 'en-US')
    expect(axis.marks[0].ts).toBeLessThanOrEqual(autumn.min)
    expect(new Date(axis.marks[0].ts).getDate()).toBe(1)
  })

  it('coarsens the same span on a narrow strip', () => {
    const wide = computeAxis(autumn.min, autumn.max, WIDE, 'en-US')
    const narrow = computeAxis(autumn.min, autumn.max, NARROW, 'en-US')
    expect(wide.granularity).toBe('month')
    expect(narrow.granularity).not.toBe('month')
    expect(narrow.marks.length).toBeLessThan(wide.marks.length)
  })

  it('lands quarter marks on the quarters', () => {
    // Eighteen months across a desktop strip: months
    // would sit 51px apart, quarters 154px.
    const axis = computeAxis(at(2024, 0, 15), at(2025, 6, 1), WIDE, 'en-US')
    expect(axis.granularity).toBe('quarter')
    for (const m of axis.marks) {
      const d = new Date(m.ts)
      expect(d.getMonth() % 3).toBe(0)
      expect(d.getDate()).toBe(1)
    }
  })

  it('keeps every mark clear of the minimum pitch', () => {
    // Two years across 600px: months would land 25px
    // apart and quarters 75px, so the step falls all the
    // way to years rather than crowd the strip.
    const axis = computeAxis(at(2023, 0, 1), at(2025, 0, 1), 600, 'en-US')
    const span = at(2025, 0, 1) - at(2023, 0, 1)
    const gaps = axis.marks.slice(1).map(
      (m, i) => ((m.ts - axis.marks[i].ts) / span) * 600
    )
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(MIN_PITCH)
  })

  it('never spells a day', () => {
    for (const width of [NARROW, 240, WIDE]) {
      const axis = computeAxis(autumn.min, autumn.max, width, 'en-US')
      for (const m of axis.marks) expect(m.text).not.toMatch(/\b\d{1,2}\b/)
    }
  })

  it('carries the year on January and nowhere else', () => {
    const axis = computeAxis(at(2025, 10, 1), at(2026, 2, 1), WIDE, 'en-US')
    expect(texts(axis)).toEqual(['Nov', 'Dec', 'Jan 2026', 'Feb', 'Mar'])
  })

  it('strides the years of a span no width could hold', () => {
    // Half a century on a phone: yearly marks would land
    // 9px apart, so the axis counts in quarter-centuries
    // rather than in a step nobody reads as a step.
    const axis = computeAxis(at(1980, 0, 1), at(2026, 0, 1), 400, 'en-US')
    expect(axis.granularity).toBe('year')
    expect(axis.stride).toBe(25)
    expect(texts(axis)).toEqual(['1975', '2000', '2025'])
  })

  it('names the axis once when a single event spans nothing', () => {
    const only = at(2025, 4, 20)
    const axis = computeAxis(only, only, WIDE, 'en-US')
    expect(texts(axis)).toEqual(['May'])
  })

  it('writes the month name in the locale it is given', () => {
    const may = { min: at(2025, 4, 1), max: at(2025, 5, 1) }
    const en = computeAxis(may.min, may.max, WIDE, 'en-US')
    const de = computeAxis(may.min, may.max, WIDE, 'de-DE')
    expect(en.marks[0].text).toBe('May')
    expect(de.marks[0].text).toBe('Mai')
  })
})
