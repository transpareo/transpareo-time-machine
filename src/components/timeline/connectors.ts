/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * SVG connector lines for the full-state timeline. Each
 * event card joins its strip dot with a rounded right-
 * angled path; this module computes the waypoints
 * (lane-finding to dodge card overlaps, rail-staggering
 * to dodge path overlaps) and serialises the SVG.
 */

import { SVG_NS } from '@/reactive/dom'
import { colorForEventType } from '@/event-colors'
import {
  type LayoutItem, PAD_X, DOT_Y_REL, topYForLevel,
} from './layout'

type Range = readonly [number, number]

function collectBlockedRanges(
  it: LayoutItem, all: ReadonlyArray<LayoutItem>,
): Range[] {
  const others = all.filter((c) => c !== it && c.level < it.level)
  return others.map((c) => [c.cardX - 4, c.cardX + c.width + 4] as const)
}

function isBlocked(x: number, ranges: ReadonlyArray<Range>): boolean {
  return ranges.some(([l, r]) => x >= l && x <= r)
}

// Build the list of clear regions between blocked
// ranges and pick the one whose target x is closest to
// `cx`. For a gap that sits between two cards we aim
// for the gap's CENTRE so the line runs centred between
// them; for the outer regions at each end of the canvas
// we keep `cx` (or the nearest inner edge).
function findSafeLane(
  it: LayoutItem, all: ReadonlyArray<LayoutItem>, cw: number,
): number {
  const cx = it.cardX + it.width / 2
  if (it.level === 0) return cx
  const blocked = collectBlockedRanges(it, all)
  if (!isBlocked(cx, blocked)) return cx

  const sorted = [...blocked].sort((a, b) => a[0] - b[0])
  const leftEdge = PAD_X
  const rightEdge = cw - PAD_X
  interface Clear { lo: number; hi: number; isInner: boolean }
  const clears: Clear[] = []
  let cursor = leftEdge
  let hadBlocked = false
  for (const [lo, hi] of sorted) {
    if (lo > cursor) {
      clears.push({ lo: cursor, hi: lo, isInner: hadBlocked })
    }
    cursor = Math.max(cursor, hi)
    hadBlocked = true
  }
  if (cursor < rightEdge) {
    clears.push({ lo: cursor, hi: rightEdge, isInner: false })
  }

  let best = cx
  let bestDist = Infinity
  for (const c of clears) {
    const target = c.isInner
      ? (c.lo + c.hi) / 2
      : (cx < c.lo ? c.lo : cx > c.hi ? c.hi : cx)
    const d = Math.abs(target - cx)
    if (d < bestDist) { bestDist = d; best = target }
  }
  return best
}

const RAIL_STEP = 4
const CORNER_R = 8

export function buildConnectorLayer(
  list: ReadonlyArray<LayoutItem>,
  cw: number,
  innerH: number,
  focusedId: string | null,
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'connector-svg')
  svg.setAttribute('width', String(cw))
  svg.setAttribute('height', String(innerH))

  // Stagger the gap0Y of each non-direct connector so
  // horizontal segments running near the strip don't
  // stack on the same line. Sort the staggered indices
  // by the connector's horizontal lane so neighbouring
  // lanes get neighbouring rails, visually they read as
  // a small staircase rather than overlap.
  const staggerY = computeRailStagger(list, cw)

  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    svg.appendChild(
      buildConnectorPath(it, list, cw, focusedId, staggerY[i]),
    )
  }
  return svg
}

// Greedy interval colouring: each non-direct connector
// has a horizontal segment at gap0Y from min(lane, dx)
// to max(lane, dx). Sort by the left edge, then assign
// each connector to the LOWEST rail whose previously-
// assigned right edge is to the left of this segment's
// left edge. Connectors whose segments don't overlap
// keep rail 0 (no Y offset); only those that would
// stack on the same line get bumped.
function computeRailStagger(
  list: ReadonlyArray<LayoutItem>, cw: number,
): number[] {
  interface Seg { i: number; lo: number; hi: number; direct: boolean }
  const segs: Seg[] = list.map((it, i) => {
    const cx = it.cardX + it.width / 2
    const lane = findSafeLane(it, list, cw)
    const dx = it.x
    const direct = cx === dx && lane === cx && it.level === 0
    return {
      i,
      lo: Math.min(lane, dx),
      hi: Math.max(lane, dx),
      direct,
    }
  })
  const sorted = [...segs]
    .filter((s) => !s.direct)
    .sort((a, b) => a.lo - b.lo)

  // Two segments must have at least RAIL_MIN_GAP between
  // them on a rail; otherwise they'd visually merge into
  // a single longer line. End-to-end touching segments
  // get bumped to a fresh rail too.
  const RAIL_MIN_GAP = 24
  const railEnds: number[] = []
  const out = new Array(list.length).fill(0)
  for (const s of sorted) {
    let rail = railEnds.findIndex((end) => end + RAIL_MIN_GAP <= s.lo)
    if (rail === -1) {
      rail = railEnds.length
      railEnds.push(s.hi)
    } else {
      railEnds[rail] = s.hi
    }
    out[s.i] = rail * RAIL_STEP
  }
  return out
}

// Build an SVG path through the given right-angled
// waypoints with rounded corners of radius `r`. Adjacent
// segments must be axis-aligned (90 degree turns). For
// each inner point we step back `r` along the incoming
// direction, draw a quadratic curve through the point,
// and continue `r` along the outgoing direction. The
// radius is clamped to half of the shorter neighbouring
// segment so the curve never overruns.
function roundedPath(points: [number, number][], r: number): string {
  // Drop adjacent duplicates so degenerate waypoints
  // (e.g. level-0 connectors where railY === gap0Y)
  // don't force a corner's incoming/outgoing length to
  // zero and turn off rounding.
  const deduped: [number, number][] = []
  for (const p of points) {
    const prev = deduped[deduped.length - 1]
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) {
      deduped.push(p)
    }
  }
  points = deduped
  if (points.length === 0) return ''
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1]
    const [cx, cy] = points[i]
    const next = points[i + 1]
    if (!next) {
      d += ` L ${cx} ${cy}`
      continue
    }
    const [nx, ny] = next
    const inDx = Math.sign(cx - px)
    const inDy = Math.sign(cy - py)
    const outDx = Math.sign(nx - cx)
    const outDy = Math.sign(ny - cy)
    const inLen = Math.max(Math.abs(cx - px), Math.abs(cy - py))
    const outLen = Math.max(Math.abs(nx - cx), Math.abs(ny - cy))

    // Half the segment when there's another corner at
    // the OTHER end of it (waypoint with a successor),
    // so adjacent curves don't overlap. Full segment
    // otherwise (a free end can absorb the full radius).
    const inFree = i === 1
    const outFree = i === points.length - 2
    const radius = Math.min(
      r,
      inFree ? inLen : inLen / 2,
      outFree ? outLen : outLen / 2,
    )
    const bx = cx - inDx * radius
    const by = cy - inDy * radius
    const ax = cx + outDx * radius
    const ay = cy + outDy * radius
    d += ` L ${bx} ${by} Q ${cx} ${cy} ${ax} ${ay}`
  }
  return d
}

// Each connector starts at the card's top centre and
// terminates at DOT_Y_REL on the dot's x, that's the
// strip-dot position 11px above the cards area, so the
// line visually lands inside the dot above.
function buildConnectorPath(
  it: LayoutItem,
  all: ReadonlyArray<LayoutItem>,
  cw: number,
  focusedId: string | null,
  railOffset: number,
): SVGPathElement {
  const cx = it.cardX + it.width / 2
  const cTop = topYForLevel(it.level)
  const lane = findSafeLane(it, all, cw)
  const dx = it.x
  const railY = cTop - 10

  // Each non-direct connector gets its own gap0Y so
  // parallel runs above row 0 sit on slightly different
  // horizontal rails rather than stacking on one line.
  const gap0Y = topYForLevel(0) - 10 - railOffset

  const lastItem = all[all.length - 1]
  const isActive = focusedId
    ? it.evt.id === focusedId
    : it === lastItem
  const direct = cx === dx && lane === cx && it.level === 0
  const points: [number, number][] = direct
    ? [[cx, cTop], [cx, DOT_Y_REL]]
    : [
        [cx, cTop],
        [cx, railY],
        [lane, railY],
        [lane, gap0Y],
        [dx, gap0Y],
        [dx, DOT_Y_REL],
      ]
  const d = roundedPath(points, CORNER_R)

  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', d)
  path.dataset.eventId = it.evt.id
  path.style.setProperty(
    '--event-color',
    colorForEventType(it.evt.eventType),
  )
  if (isActive) path.classList.add('active')
  return path
}
