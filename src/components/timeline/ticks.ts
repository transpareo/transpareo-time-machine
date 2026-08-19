/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Time-axis resolution for <dpp-timeline>. Picks the
 * finest step (month / quarter / year) whose marks clear
 * a minimum pixel pitch on the band of canvas the events
 * span, walks that range on calendar boundaries, and
 * names each mark. The names are month names: a mark says
 * which month the strip has reached, never which day, so
 * the axis reads the same whatever the span. The width
 * comes in as an argument, so a narrower strip resolves
 * to a coarser step rather than to crowded marks.
 */

export type Granularity = 'month' | 'quarter' | 'year'

export interface AxisMark {
  ts: number
  text: string
}

export interface Axis {
  granularity: Granularity
  stride: number
  marks: AxisMark[]
}

// Pixels a step must span before the axis will use it.
// The widest label the axis writes is a January in a long
// locale ("Okt 2026", 62px at the label's type), and a
// slot gives up part of its width so the label lets go of
// the pane edge before the next mark arrives. 120px
// leaves that label its width, the handover its share,
// and enough left over that a pinned label reads as
// pinned rather than as passing through.
export const MIN_PITCH = 120

// Nominal step lengths, for reading a step off a span.
// Only their ratio to the span matters here; the marks
// themselves are walked on real calendar boundaries, so
// the drift of a 30.44-day month never reaches the DOM.
const STEP_MS: Record<Granularity, number> = {
  month: 2_629_800_000,
  quarter: 7_889_400_000,
  year: 31_557_600_000
}

const LADDER: Granularity[] = ['month', 'quarter', 'year']

// Steps in months, so one cursor walks every
// granularity.
const STEP_MONTHS: Record<Granularity, number> = {
  month: 1, quarter: 3, year: 12
}

// Strides for a span so long that even yearly marks
// crowd. Decades and quarter-centuries read as intended
// where 3 or 7 years would look arbitrary.
const STRIDES = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]

export function computeAxis(
  min: number, max: number, width: number, locale: string
): Axis {
  const span = Math.max(max - min, 1)
  const usable = Math.max(width, 1)
  const pitch = (g: Granularity, stride: number): number =>
    (usable * STEP_MS[g] * stride) / span

  const granularity = LADDER.find((g) => pitch(g, 1) >= MIN_PITCH)
    ?? 'year'
  const stride = granularity === 'year'
    ? STRIDES.find((s) => pitch('year', s) >= MIN_PITCH)
      ?? STRIDES[STRIDES.length - 1]
    : 1

  // The walk starts at the top of the period the first
  // event falls inside, so the first mark sits at or
  // before that event. That mark is what names the left
  // edge of the strip: its label has nowhere to sit but
  // the start, and rides there until the next one
  // arrives.
  const marks: AxisMark[] = []
  const cursor = new Date(min)
  alignCursor(cursor, granularity, stride)
  while (cursor.getTime() <= max) {
    marks.push({
      ts: cursor.getTime(),
      text: labelFor(cursor, granularity, locale)
    })
    cursor.setMonth(cursor.getMonth() + STEP_MONTHS[granularity] * stride)
  }
  return { granularity, stride, marks }
}

function alignCursor(d: Date, g: Granularity, stride: number): void {
  d.setHours(0, 0, 0, 0)
  d.setDate(1)
  if (g === 'quarter') d.setMonth(Math.floor(d.getMonth() / 3) * 3)
  if (g === 'year') {
    d.setMonth(0)
    d.setFullYear(Math.floor(d.getFullYear() / stride) * stride)
  }
}

// The locale comes in explicitly (the caller passes the
// SPA's active locale) so a visitor who switched language
// doesn't get axis labels in the browser's locale while
// every other date on the page follows the picker.
function labelFor(d: Date, g: Granularity, locale: string): string {
  const year = String(d.getFullYear())
  if (g === 'year') return year
  const month = d.toLocaleDateString(locale, { month: 'short' })

  // January carries its year, so a strip crossing a turn
  // says which year it moved into without spelling a
  // date on every other mark.
  return d.getMonth() === 0 ? `${month} ${year}` : month
}
