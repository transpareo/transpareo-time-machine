// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Regression for the full-state connector routing. A
 * multi-row layout fans the lower row's connectors up
 * between the upper row's cards; the near-strip rails are
 * staggered so a longer run sits above the shorter runs it
 * spans. This locks in "no two connectors cross", the
 * tangle the rail ordering was changed to remove.
 */
import { describe, expect, it } from 'vitest'
import { buildConnectorLayer } from '../src/components/timeline/connectors'
import {
  layOut, buildLinearProjection, stageHeight,
  CARD_W, CARD_GAP, PAD_X,
} from '../src/components/timeline/layout'
import type { DppEvent } from '../src/types'

type Pt = [number, number]
type Seg = [Pt, Pt]

function evts(times: string[]): DppEvent[] {
  return times.map((occurredAt, i) => ({
    id: `e${i}`, eventType: 'published', occurredAt,
  })) as unknown as DppEvent[]
}

// The canvas width the timeline uses: ceil(n / rows)
// card-columns plus the end padding.
function gridWidth(n: number, rows: number): number {
  const columns = Math.ceil(n / rows)
  return columns * (CARD_W + CARD_GAP) - CARD_GAP + 2 * PAD_X
}

// Every coordinate pair along the path, in order. Adjacent
// pairs are the orthogonal runs (the rounded corners add
// short axis-aligned hops, which the crossing test below
// handles like any other run).
function pointsOf(d: string): Pt[] {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const pts: Pt[] = []
  for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]])
  return pts
}

function segsOf(pts: Pt[]): Seg[] {
  const out: Seg[] = []
  for (let i = 1; i < pts.length; i++) out.push([pts[i - 1], pts[i]])
  return out
}

// A proper crossing of one horizontal and one vertical run
// (a shared endpoint is not a crossing).
function crosses(a: Seg, b: Seg): boolean {
  const aH = a[0][1] === a[1][1]
  const bH = b[0][1] === b[1][1]
  if (aH === bH) return false
  const h = aH ? a : b
  const v = aH ? b : a
  const hy = h[0][1]
  const hx1 = Math.min(h[0][0], h[1][0])
  const hx2 = Math.max(h[0][0], h[1][0])
  const vx = v[0][0]
  const vy1 = Math.min(v[0][1], v[1][1])
  const vy2 = Math.max(v[0][1], v[1][1])
  return vx > hx1 && vx < hx2 && hy > vy1 && hy < vy2
}

function connectorCrossings(times: string[], rows: number): number {
  const list = evts(times)
  const cw = gridWidth(times.length, rows)
  const proj = buildLinearProjection(list, cw, CARD_W / 2)
  const layout = layOut(list, rows, proj.xFor, cw)
  const svg = buildConnectorLayer(layout, cw, stageHeight(layout), null)
  const runs = [...svg.querySelectorAll('path')]
    .map((p) => segsOf(pointsOf(p.getAttribute('d') ?? '')))
  let count = 0
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      for (const sa of runs[i]) {
        for (const sb of runs[j]) if (crosses(sa, sb)) count++
      }
    }
  }
  return count
}

// An interleaved 2024/2025 feed: across two rows the lower
// row's runs fan up between the upper row's cards, so a
// long run and a shorter one it spans land near the strip
// together, the case the old left-edge rail order crossed.
const INTERLEAVED = [
  '2024-01-15T00:00:00Z', '2024-05-15T00:00:00Z',
  '2024-10-01T00:00:00Z', '2025-04-18T00:00:00Z',
  '2025-06-09T00:00:00Z', '2025-06-15T00:00:00Z',
  '2025-09-12T00:00:00Z',
]

describe('buildConnectorLayer', () => {
  it('routes a two-row timeline without crossing connectors', () => {
    expect(connectorCrossings(INTERLEAVED, 2)).toBe(0)
  })

  it('routes a three-row timeline without crossing connectors', () => {
    expect(connectorCrossings(INTERLEAVED, 3)).toBe(0)
  })
})
