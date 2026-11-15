// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The brand's note on an event. The public events file
 * carries it under `schema:description` as a JSON-LD
 * language array, one entry per language the note was
 * written or translated in. The renderer folds it to the
 * reader's language with the usual fallback; the timeline
 * card keeps the event's summary line and shows the note
 * below it, and the event modal shows it under its own
 * heading.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { events, focusedEventId, timelineFeed, timelineState } from '@/state'
import { eventModalEventId } from '@/components/dpp-event-modal'
import '@/components/timeline'
import type { EpcisDocument } from '@/epcis'

const NOTE = [
  { '@value': 'Erste Kundenaktivierung erfasst.', '@language': 'de' },
  { '@value': 'First customer activation recorded.', '@language': 'en' }
]

function feedWith(extensions: Record<string, unknown>): EpcisDocument {
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
        'transpareo:statusFrom': 'placed_on_market',
        'transpareo:statusTo': 'in_use',
        'transpareo:versionNumber': 3,
        ...extensions
      }]
    }
  } as unknown as EpcisDocument
}

function parsed(extensions: Record<string, unknown>): unknown {
  timelineFeed.set(feedWith(extensions))
  return events()[0]?.description
}

function mount(
  state: 'expanded' | 'full',
  extensions: Record<string, unknown>,
): HTMLElement {
  document.body.replaceChildren()
  timelineFeed.set(feedWith(extensions))
  focusedEventId.set('e1')
  timelineState.set(state)
  const timeline = document.createElement('dpp-timeline')
  document.body.append(timeline)
  return timeline
}

afterEach(() => {
  document.body.replaceChildren()
  eventModalEventId.set(null)
  focusedEventId.set(null)
  timelineState.set('hidden')
  timelineFeed.set(null)
})

describe('the note on the wire', () => {
  it('folds the language array to a locale map', () => {
    expect(parsed({ 'schema:description': NOTE })).toEqual({
      de: 'Erste Kundenaktivierung erfasst.',
      en: 'First customer activation recorded.'
    })
  })

  it('reads a note without a language as it stands', () => {
    expect(parsed({ 'schema:description': 'Batch released.' }))
      .toBe('Batch released.')
  })

  // The v1 term names a passport's own text; the platform
  // never writes it on an event.
  it('reads no note from the passport term', () => {
    expect(parsed({ 'transpareo:description': 'Old note' })).toBeUndefined()
  })

  it('drops a value that is no text', () => {
    expect(parsed({ 'schema:description': 3 })).toBeUndefined()
    expect(parsed({ 'schema:description': [] })).toBeUndefined()
    expect(parsed({ 'schema:description': [{ '@value': 'x' }] }))
      .toBeUndefined()
  })
})

describe.each(['expanded', 'full'] as const)('the %s card', (state) => {
  const body = (root: HTMLElement): string[] => [
    ...root.querySelectorAll('.event-summary, .event-note')
  ].map((p) => `${p.className}: ${p.textContent}`)

  it('shows the summary, then the note', () => {
    const lines = body(mount(state, { 'schema:description': NOTE }))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/event-summary: .*new lifecycle stage: in use/)
    expect(lines[1]).toMatch(/event-note: First customer activation/)
  })

  it('names the language of a note it fell back to', () => {
    const de = [NOTE[0]]
    const note = mount(state, { 'schema:description': de })
      .querySelector('.event-note')
    expect(note?.getAttribute('lang')).toBe('de')
  })

  it('shows the summary alone without a note', () => {
    const lines = body(mount(state, {}))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^.*event-summary: /)
  })

  it('shows the note alone when the stage has no summary', () => {
    const timeline = mount(state, {
      'transpareo:statusTo': 'retired',
      'schema:description': NOTE
    })
    expect(body(timeline)).toEqual([
      expect.stringMatching(/event-note: First customer activation/)
    ])
  })
})

describe('the event modal', () => {
  it('shows the note in the reader language', () => {
    timelineFeed.set(feedWith({ 'schema:description': NOTE }))
    document.body.append(document.createElement('dpp-event-modal'))
    eventModalEventId.set('e1')
    const note = document.querySelector('.event-modal-description')
    expect(note?.textContent).toBe('First customer activation recorded.')
    expect(note?.hasAttribute('lang')).toBe(false)
  })
})
