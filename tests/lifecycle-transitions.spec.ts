/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Every lifecycle move a passport can make, as the feed
 * states it. A `lifecycle_transition` event names the stage
 * it came from and the stage it moved into, and both are
 * rendered as words: the event modal reads "from - to", the
 * card body names the new stage in its summary line.
 *
 * Two ways that breaks, both of which have shipped:
 *
 *   - A stage nobody translated renders its own key, so the
 *     card reads "status.manufactured".
 *   - canonicalStatus folds a token it does not know onto
 *     'draft', so a stage this build has never heard of
 *     renders as a different, wrong stage instead of as a
 *     gap. That one is silent: the card reads a real word.
 *
 * So the table below is the specification. Each pair goes
 * through the feed parse and comes back as itself, in both
 * spellings the wire uses, and every stage in it carries a
 * label.
 */

import { describe, it, expect, afterEach } from 'vitest'
import * as host from '@/host'
import { events } from '@/state'
import { LIFECYCLE_STATUSES, canonicalStatus } from '@/types'
import type { LifecycleStatus } from '@/types'
import { t, englishLabels } from '@/i18n/labels'
import type { LabelKey } from '@/i18n/labels'
import type { EpcisDocument } from '@/epcis'

type Moves = Readonly<Record<LifecycleStatus, readonly LifecycleStatus[]>>

const TRANSITIONS: Moves = {
  draft: ['manufactured', 'placed_on_market', 'suspended'],
  manufactured: ['placed_on_market', 'suspended'],
  placed_on_market: ['in_use', 'suspended'],
  in_use: ['repair', 'collected', 'refurbished', 'suspended'],
  repair: ['in_use', 'refurbished', 'collected', 'end_of_life'],
  refurbished: ['placed_on_market', 'in_use', 'collected'],
  collected: ['recycled', 'end_of_life', 'refurbished'],
  recycled: ['end_of_life'],
  end_of_life: [],
  suspended: ['draft', 'manufactured', 'placed_on_market', 'in_use']
}

const PAIRS = Object.entries(TRANSITIONS).flatMap(
  ([from, tos]) => tos.map((to) => [from, to] as const)
)

// The wire spells a stage in camelCase (`placedOnMarket`);
// the renderer's enum, colour map and label keys are
// snake_case. Both spellings reach the parse, so both are
// tested against the same table.
function camel(status: string): string {
  return status.replace(/_(.)/g, (_, c: string) => c.toUpperCase())
}

function feedWith(from: string, to: string): EpcisDocument {
  return {
    type: 'EPCISDocument',
    epcisBody: {
      eventList: [{
        type: 'ObjectEvent',
        eventID: 'urn:uuid:e1',
        eventTime: '2026-09-21T08:00:00Z',
        eventTimeZoneOffset: '+00:00',
        action: 'OBSERVE',
        epcList: [],
        'transpareo:dppEventId': 'e1',
        'transpareo:eventType': 'lifecycle_transition',
        'transpareo:statusFrom': from,
        'transpareo:statusTo': to
      }]
    }
  } as unknown as EpcisDocument
}

function parsePair(from: string, to: string): [unknown, unknown] {
  host.epcisDocument.set(feedWith(from, to))
  const evt = events()[0]
  return [evt?.statusFrom, evt?.statusTo]
}

afterEach(() => {
  host.epcisDocument.set(null)
})

describe('lifecycle transitions', () => {
  // The table and the enum are two statements of the same
  // set, and the enum is what the label keys and the parse
  // are built from. A stage added to one and not the other
  // leaves a move nothing here covers.
  it('covers every lifecycle stage', () => {
    expect(Object.keys(TRANSITIONS).sort())
      .toEqual([...LIFECYCLE_STATUSES].sort())
  })

  it.each(PAIRS)('carries %s to %s through the feed', (from, to) => {
    expect(parsePair(from, to)).toEqual([from, to])
  })

  it.each(PAIRS)('carries %s to %s in wire spelling', (from, to) => {
    expect(parsePair(camel(from), camel(to))).toEqual([from, to])
  })

  // The fold that makes a gap look like a stage: without a
  // wire entry, canonicalStatus answers 'draft' and the card
  // names a stage the unit was never in.
  it.each([...LIFECYCLE_STATUSES])('%s is its own stage', (status) => {
    expect(canonicalStatus(status)).toBe(status)
    expect(canonicalStatus(camel(status))).toBe(status)
  })

  it.each([...LIFECYCLE_STATUSES])('%s reads as a word', (status) => {
    const key = `status.${status}` as LabelKey
    expect(t(englishLabels, key)).not.toBe(key)
  })
})
