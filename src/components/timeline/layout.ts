/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure positioning math for <dpp-timeline>. The strip
 * dot x's (linear projection) and the full-state card
 * grid (alternating-row layout with collision-avoiding
 * push). No DOM, no state.
 */

import { eventTime } from '@/epcis'
import type { DppEvent } from '@/types'

export const PAD_X = 32

// Full-state card layout. CARD_W / CARD_H are the
// rendered card dimensions; CARD_GAP is the horizontal
// space between neighbouring cards on the same row.
// LEVEL_HEIGHT is the row stride and TOP_GAP is the
// breathing room between the strip and the first card
// row.
export const CARD_W = 220
export const CARD_H = 144
export const CARD_GAP = 11
export const LEVEL_GAP_Y = 20
export const LEVEL_HEIGHT = CARD_H + LEVEL_GAP_Y
export const TOP_GAP = 48

// The strip is 22px tall with the dot centred on its
// midline, so the dot sits 11px above the strip's
// bottom, i.e. 11px above the top of .full-area, which
// the connector SVG renders into via overflow:visible.
export const DOT_Y_REL = -11

export interface Projection {
  xFor: (ts: number) => number
  totalWidth: number
  gaps: ReadonlyArray<{ x: number; width: number }>
  isInGap: (ts: number) => boolean
}

// Linear time-scale across a caller-supplied canvas
// width. Events stay at their literal time positions
// `edgeInset` reserves space at each end so a card
// centred on the first or last dot still fits within
// the canvas, without it the rightmost card's right
// edge spills past contentWidth and the scroll-pane
// reports a wider scrollWidth in full state than in
// expanded.
export function buildLinearProjection(
  events: ReadonlyArray<DppEvent>,
  canvasW: number,
  edgeInset = 0,
): Projection {
  if (!events.length) {
    return {
      xFor: () => PAD_X,
      totalWidth: canvasW,
      gaps: [],
      isInGap: () => false,
    }
  }
  const min = eventTime(events[0].occurredAt)
  const last = events[events.length - 1]
  const max = Math.max(eventTime(last.occurredAt), min + 1)
  const usable = Math.max(canvasW - 2 * PAD_X - 2 * edgeInset, 1)
  const left = PAD_X + edgeInset
  return {
    // Round so dots, ticks, and connector endpoints all
    // land on integer pixels, keeps 1px strokes crisp.
    xFor: (ts) => Math.round(
      left + ((ts - min) / (max - min)) * usable,
    ),
    totalWidth: canvasW,
    gaps: [],
    isInGap: () => false,
  }
}

export interface LayoutItem {
  evt: DppEvent
  x: number
  cardX: number
  width: number
  level: number
}

// Cards alternate between rows in event order, so dense
// clusters lay out like a grid rather than overflowing
// one row. Each card prefers to sit centred under its
// event's time-dot; where neighbours collide or the
// canvas edge is reached, the row is redistributed so
// cards shift into whichever side still has room. A
// cluster against the right edge therefore fans LEFT
// into the empty run of canvas before it rather than
// spilling past the right edge.
export function layOut(
  list: ReadonlyArray<DppEvent>,
  rows: number,
  xFor: (ts: number) => number,
  canvasW: number,
): LayoutItem[] {
  const out: LayoutItem[] = new Array(list.length)
  const leftBound = PAD_X
  const rightBound = canvasW - PAD_X - CARD_W
  for (let r = 0; r < rows; r++) {
    const idxs: number[] = []
    for (let i = r; i < list.length; i += rows) idxs.push(i)
    const dotXs = idxs.map(
      (i) => Math.round(xFor(eventTime(list[i].occurredAt))),
    )
    const cardXs = placeRow(
      dotXs.map((x) => x - CARD_W / 2), leftBound, rightBound,
    )
    idxs.forEach((i, k) => {
      out[i] = {
        evt: list[i], x: dotXs[k], cardX: cardXs[k],
        width: CARD_W, level: r,
      }
    })
  }
  return out
}

// Resolve one row of preferred (dot-centred) card x's into
// non-overlapping positions inside [leftBound, rightBound].
// A left-to-right sweep clears overlaps by pushing right; a
// right-to-left sweep then pulls any card that ran past
// rightBound back inward, cascading the shift left into the
// free space. Each card stays as close to its preferred x
// as the row allows. The canvas is sized (see contentWidth)
// so the fullest row's cards fit exactly, so the leftward
// cascade never underflows leftBound.
function placeRow(
  prefer: ReadonlyArray<number>, leftBound: number, rightBound: number,
): number[] {
  const step = CARD_W + CARD_GAP
  const xs: number[] = []
  let prev = -Infinity
  for (const p of prefer) {
    prev = Math.max(p, leftBound, prev + step)
    xs.push(prev)
  }
  let next = Infinity
  for (let i = xs.length - 1; i >= 0; i--) {
    next = Math.min(xs[i], rightBound, next - step)
    xs[i] = next
  }
  return xs
}

export function stageHeight(list: ReadonlyArray<LayoutItem>): number {
  const maxLevel = list.reduce((m, it) => Math.max(m, it.level), 0)
  return TOP_GAP + (maxLevel + 1) * LEVEL_HEIGHT
}

export function topYForLevel(level: number): number {
  return TOP_GAP + level * LEVEL_HEIGHT
}
