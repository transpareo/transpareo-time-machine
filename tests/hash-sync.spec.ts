// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * bootstrapHash's two-way binding between the URL hash and
 * (focusedEventId, timelineState). Back / forward drives the
 * timeline, but a history event that leaves the hash where it
 * was is not a navigation: an open modal keeps one extra
 * entry on the stack carrying the current URL, so dismissing
 * it pops onto a twin of the entry we are already on. Acting
 * on that closed the open history whenever no event was
 * focused (no hash to compare against).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { EpcisDocument } from '../src/epcis'

function ev(
  id: string, occurredAt: string, versionNumber?: number,
): Record<string, unknown> {
  return {
    type: 'ObjectEvent',
    eventTime: occurredAt,
    'transpareo:dppEventId': id,
    'transpareo:eventType':
      versionNumber != null ? 'published' : 'inspection',
    ...(versionNumber != null
      ? { 'transpareo:versionNumber': versionNumber }
      : {}),
  }
}

const FEED = {
  epcisBody: {
    eventList: [
      ev('pub-1', '2024-01-01T00:00:00Z', 1),
      ev('insp-a', '2024-06-01T00:00:00Z'),
      ev('pub-2', '2025-01-01T00:00:00Z', 2),
    ],
  },
} as unknown as EpcisDocument

type State = typeof import('../src/state')

// Each case needs its own module epoch: bootstrapHash guards
// against re-entry, and the initial hash is read once at
// bootstrap. The window is shared across the file, so the
// listeners a previous epoch registered are tracked here and
// dropped before the next one runs.
const registered: Array<[string, EventListener]> = []

async function bootstrap(hash: string): Promise<State> {
  vi.resetModules()
  window.location.hash = hash
  const host = await import('../src/host')
  const state = await import('../src/state')
  host.epcisDocument.set(FEED)
  host.currentVersion.set(2)
  const { bootstrapHash } = await import('../src/bootstrap')
  bootstrapHash()
  return state
}

function popstate(): void {
  window.dispatchEvent(new Event('popstate'))
}

beforeEach(() => {
  const add = window.addEventListener.bind(window)
  vi.spyOn(window, 'addEventListener').mockImplementation(
    (type: string, fn: EventListenerOrEventListenerObject | null) => {
      registered.push([type, fn as EventListener])
      add(type, fn as EventListener)
    },
  )
})

afterEach(() => {
  for (const [type, fn] of registered) window.removeEventListener(type, fn)
  registered.length = 0
  vi.restoreAllMocks()
  window.location.hash = ''
})

describe('bootstrapHash: same-hash history events', () => {
  it('leaves an open, unfocused history alone', async () => {
    const state = await bootstrap('')
    state.timelineState.set('expanded')

    // The balance pop a closing modal fires: same URL, so the
    // absent hash must not be read as "close the history".
    popstate()

    expect(state.timelineState()).toBe('expanded')
    expect(state.focusedEventId()).toBe(null)
  })

  it('leaves a deep-linked history alone', async () => {
    const state = await bootstrap('#pub-1')
    expect(state.timelineState()).toBe('expanded')

    popstate()

    expect(state.timelineState()).toBe('expanded')
    expect(state.focusedEventId()).toBe('pub-1')
  })
})

describe('bootstrapHash: real back / forward', () => {
  it('closes the history when the hash is cleared', async () => {
    const state = await bootstrap('#pub-1')

    window.location.hash = ''
    popstate()

    expect(state.timelineState()).toBe('hidden')
    expect(state.focusedEventId()).toBe(null)
  })

  it('focuses the event the hash names', async () => {
    const state = await bootstrap('')

    window.location.hash = '#pub-2'
    popstate()

    expect(state.timelineState()).toBe('expanded')
    expect(state.focusedEventId()).toBe('pub-2')
  })
})
