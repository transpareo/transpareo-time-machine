/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Coverage for layOut(), the full-state card placement.
 * The function snaps each card under its event's time-dot
 * but must keep every card inside the canvas: a cluster of
 * near-simultaneous events at the right edge has to fan
 * LEFT into the empty run before it rather than spilling
 * past the strip. These cases lock in "never wider than
 * the card grid" and "never past the right edge", the two
 * regressions that motivated the space-aware layout.
 */
import { describe, expect, it } from 'vitest'
import {
  layOut, buildLinearProjection, CARD_W, CARD_GAP, PAD_X,
} from '../src/components/timeline/layout'
import { eventTime } from '../src/epcis'
import type { DppEvent } from '../src/types'

// Minimal events; layOut only reads `occurredAt`.
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

function place(times: string[], rows: number, canvasW: number) {
  const list = evts(times)
  const proj = buildLinearProjection(list, canvasW, CARD_W / 2)
  return layOut(list, rows, proj.xFor, canvasW)
}

// Two events in 2024 then four within ninety minutes on one
// day in 2026: the right-edge cluster that used to diverge.
const CLUSTER = [
  '2024-01-01T00:00:00Z',
  '2024-06-01T00:00:00Z',
  '2026-06-04T20:18:56Z',
  '2026-06-04T21:44:55Z',
  '2026-06-04T21:46:03Z',
  '2026-06-04T21:50:00Z',
]

describe('layOut', () => {
  it('keeps every card inside the canvas for a right cluster', () => {
    const cw = gridWidth(CLUSTER.length, 2)
    for (const it of place(CLUSTER, 2, cw)) {
      expect(it.cardX).toBeGreaterThanOrEqual(PAD_X)
      expect(it.cardX + it.width).toBeLessThanOrEqual(cw - PAD_X)
    }
  })

  it('never overlaps two cards on the same row', () => {
    const cw = gridWidth(CLUSTER.length, 2)
    const layout = place(CLUSTER, 2, cw)
    for (let r = 0; r < 2; r++) {
      const row = layout
        .filter((it) => it.level === r)
        .sort((a, b) => a.cardX - b.cardX)
      for (let i = 1; i < row.length; i++) {
        expect(row[i].cardX - row[i - 1].cardX)
          .toBeGreaterThanOrEqual(CARD_W + CARD_GAP)
      }
    }
  })

  it('fans a right-edge cluster left of its dot', () => {
    const cw = gridWidth(CLUSTER.length, 2)
    const cluster = place(CLUSTER, 2, cw)
      .filter((it) => it.evt.occurredAt.startsWith('2026-06-04'))
    const fannedLeft = cluster
      .filter((it) => it.cardX + CARD_W / 2 < it.x)
    expect(fannedLeft.length).toBeGreaterThan(0)
  })

  it('centres a card under its dot when the row has room', () => {
    // A canvas far wider than the two-card grid leaves the
    // dots spread out, so neither card has to shift.
    for (const it of place(
      ['2020-01-01T00:00:00Z', '2026-01-01T00:00:00Z'], 1, 2000,
    )) {
      expect(it.cardX + CARD_W / 2).toBe(it.x)
    }
  })
})

describe('eventTime', () => {
  it('parses a valid timestamp', () => {
    expect(eventTime('1970-01-01T00:00:01Z')).toBe(1000)
  })

  it('pins a malformed timestamp to epoch 0', () => {
    expect(eventTime('not-a-date')).toBe(0)
    expect(eventTime('')).toBe(0)
  })
})

describe('layout with a malformed occurredAt', () => {
  it('yields finite positions instead of NaN', () => {
    // A feed with one broken timestamp must not poison the
    // projection: every dot and card still gets a finite,
    // in-canvas x.
    const items = place(
      ['garbage', '2025-06-01T00:00:00Z', '2026-01-01T00:00:00Z'],
      1, 2000,
    )
    for (const it of items) {
      expect(Number.isFinite(it.x)).toBe(true)
      expect(Number.isFinite(it.cardX)).toBe(true)
    }
  })
})
