// @vitest-environment happy-dom
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
 *   - A token this build does not know renders as another,
 *     real stage ("draft"). That one is silent: the card
 *     reads a real word.
 *
 * So the table below is the specification. Each pair goes
 * through the feed parse and comes back as itself, in both
 * spellings the wire uses, and every stage in it carries a
 * label. A token outside the table is no stage at all: the
 * parse drops it, the card and the modal leave it out, and
 * the console names it once.
 */

import {
  describe, it, expect, afterEach, beforeEach, vi, type MockInstance
} from 'vitest'
import * as host from '@/host'
import { events, focusedEventId, timelineFeed, timelineState } from '@/state'
import { eventModalEventId } from '@/components/dpp-event-modal'
import '@/components/timeline'
import { LIFECYCLE_STATUSES, canonicalStatus } from '@/types'
import type { LifecycleStatus } from '@/types'
import type { SignedSnapshot } from '@/archive'
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
  timelineFeed.set(feedWith(from, to))
  const evt = events()[0]
  return [evt?.statusFrom, evt?.statusTo]
}

afterEach(() => {
  timelineFeed.set(null)
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

  // Without a wire entry a stage is no stage, so each one
  // needs its own entry in both spellings.
  it.each([...LIFECYCLE_STATUSES])('%s is its own stage', (status) => {
    expect(canonicalStatus(status)).toBe(status)
    expect(canonicalStatus(camel(status))).toBe(status)
  })

  it.each([...LIFECYCLE_STATUSES])('%s reads as a word', (status) => {
    const key = `status.${status}` as LabelKey
    expect(t(englishLabels, key)).not.toBe(key)
  })
})

// The console names each unknown token once per page, so
// every case below spells its own token.
describe('a stage this build does not know', () => {
  let warn: MockInstance<typeof console.warn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warn.mockRestore()
    document.body.replaceChildren()
    eventModalEventId.set(null)
    focusedEventId.set(null)
    timelineState.set('hidden')
  })

  it('is no stage, named once in the console', () => {
    expect(canonicalStatus('awaitingAudit')).toBeUndefined()
    expect(canonicalStatus('awaitingAudit')).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0][0])).toContain('"awaitingAudit"')
  })

  it('is no stage when the token is missing, silently', () => {
    expect(canonicalStatus(undefined)).toBeUndefined()
    expect(canonicalStatus(null)).toBeUndefined()
    expect(canonicalStatus(3)).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  // The wire table is a plain object; the names it inherits
  // are no stages either.
  it('is no stage for a name the wire table inherits', () => {
    expect(canonicalStatus('constructor')).toBeUndefined()
    expect(canonicalStatus('toString')).toBeUndefined()
  })

  it('drops out of a transition and leaves the known side', () => {
    expect(parsePair('in_use', 'quarantined')).toEqual(['in_use', undefined])
    expect(parsePair('onHold', 'inUse')).toEqual([undefined, 'in_use'])
  })

  it('is no stage on a snapshot', () => {
    const model = host.toRenderModel(wireSnapshot('mothballed'))
    expect(model.status).toBeUndefined()
    expect(host.toRenderModel(wireSnapshot('inUse')).status).toBe('in_use')
  })

  // The summary line names the new stage; with none known
  // it is left out, and the card keeps its tag and date.
  it('leaves the card without a summary line', () => {
    const card = expandedCard('in_use', 'in_use')
    expect(card.textContent).toContain('new lifecycle stage: in use')

    const unknown = expandedCard('in_use', 'retired')
    expect(unknown.querySelector('.event-details-desc')).toBeNull()
    expect(unknown.textContent).not.toContain('{status}')
    expect(unknown.textContent).not.toContain('draft')
    expect(unknown.querySelector('.event-tag')).not.toBeNull()
  })

  it('leaves the modal without the stage', () => {
    const known = modalGrid('in_use', 'repair')
    expect(known.querySelector('.event-modal-status')).not.toBeNull()

    const to = modalGrid('in_use', 'scrapped')
    expect(to.querySelector('.event-modal-status')).toBeNull()
    expect(to.textContent).not.toContain('draft')

    const from = modalGrid('dormant', 'repair')
    expect(from.querySelector('.event-modal-status')).toBeNull()
    expect(from.textContent).toContain('repair')
    expect(from.textContent).not.toContain('draft')
  })
})

function wireSnapshot(dppStatus: string): SignedSnapshot {
  return {
    version: 1,
    publishedAt: '2026-01-01T00:00:00Z',
    passportAlias: 'a1b2-c3d4-e5f6',
    dppStatus,
    issuer: { '@type': 'Organization', name: 'Issuer', did: 'did:web:i' },
    platform: { '@type': 'Organization', name: 'Platform', did: 'did:web:p' },
    product: { '@type': 'Product', name: { en: 'X' }, properties: [] },
    proof: []
  } as unknown as SignedSnapshot
}

// Both mount on a feed of the one event, loaded the way
// the table loads its pairs.
function expandedCard(from: string, to: string): HTMLElement {
  document.body.replaceChildren()
  parsePair(from, to)
  focusedEventId.set('e1')
  timelineState.set('expanded')
  const timeline = document.createElement('dpp-timeline')
  document.body.append(timeline)
  return timeline.querySelector<HTMLElement>('.event-details')!
}

function modalGrid(from: string, to: string): HTMLElement {
  document.body.replaceChildren()
  parsePair(from, to)
  document.body.append(document.createElement('dpp-event-modal'))
  eventModalEventId.set('e1')
  return document.querySelector<HTMLElement>('.event-modal-grid')!
}
