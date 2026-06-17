/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Time-axis tick computation for <dpp-timeline>. Picks
 * a granularity (day / week / month / quarter / year)
 * suited to the visible span, walks the range to emit
 * one timestamp per tick, and decides which ticks carry
 * a visible label.
 */

export type Granularity =
  | 'day' | 'week' | 'month' | 'quarter' | 'year'

// Pick a tick granularity that lands a comfortable
// number of marks across the span. Returns timestamps
// + the granularity (used to format labels).
export function computeTicks(
  min: number, max: number,
): { granularity: Granularity; ticks: number[] } {
  const span = max - min
  const day = 86_400_000
  const granularity: Granularity = (() => {
    if (span <= day * 7) return 'day'
    if (span <= day * 60) return 'week'
    if (span <= day * 365 * 1.5) return 'month'
    if (span <= day * 365 * 5) return 'quarter'
    return 'year'
  })()

  const ticks: number[] = []
  const cursor = new Date(min)
  const end = new Date(max)
  const stepUp = STEP_BY[granularity]

  alignCursor(cursor, granularity)
  while (cursor.getTime() <= end.getTime()) {
    ticks.push(cursor.getTime())
    stepUp(cursor)
  }
  return { granularity, ticks }
}

const STEP_BY: Record<Granularity, (d: Date) => void> = {
  day: (d) => d.setDate(d.getDate() + 1),
  week: (d) => d.setDate(d.getDate() + 7),
  month: (d) => d.setMonth(d.getMonth() + 1),
  quarter: (d) => d.setMonth(d.getMonth() + 3),
  year: (d) => d.setFullYear(d.getFullYear() + 1),
}

function alignCursor(d: Date, g: Granularity): void {
  d.setHours(0, 0, 0, 0)
  if (g === 'month' || g === 'quarter' || g === 'year') d.setDate(1)
  if (g === 'quarter') d.setMonth(Math.floor(d.getMonth() / 3) * 3)
  if (g === 'year') d.setMonth(0)
}

// Year shows on yearly ticks and on the January tick of
// quarter / month granularities. Other ticks stay
// unlabelled, the strip would otherwise get cluttered.
// The locale comes in explicitly (the caller passes the
// SPA's active locale) so a visitor who switched language
// doesn't get tick labels in the browser's locale while
// every other date on the page follows the picker.
export function labelFor(
  ts: number, g: Granularity, locale: string,
): string {
  const d = new Date(ts)
  const year = String(d.getFullYear())
  if (g === 'year') return year
  if ((g === 'quarter' || g === 'month') && d.getMonth() === 0) {
    return year
  }
  if (g === 'week') {
    return d.toLocaleDateString(locale, {
      month: 'short', day: 'numeric',
    })
  }
  if (g === 'day') {
    return d.toLocaleDateString(locale, { day: 'numeric' })
  }
  return ''
}
