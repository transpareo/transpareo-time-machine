// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * When the events feed's signature is judged.
 *
 * The boot does not wait for the feed any more, so the
 * mount is no longer the moment the document is there.
 * ensureEventsVerified is memoised on its first call, and
 * a verdict latched while the feed was still in flight
 * would leave a signed feed reading as unsigned for the
 * rest of the visit: 'absent' is the answer for a passport
 * that has no feed, not for one whose feed has not arrived.
 *
 * The proof modal's events badge reads that state, so the
 * difference is visible: "no signature" against "checking".
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as host from '@/host'
import { eventsProofState } from '@/state'
import { ensureEventsVerified, resetVerifyCaches } from '@/actions'
import type { EpcisDocument } from '@/epcis'

// A feed carrying a signature block, so a verdict read off
// the document is an entry object and can never be mistaken
// for the 'absent' a missing document produces.
const SIGNED_FEED = {
  type: 'EPCISDocument',
  epcisBody: { eventList: [] },
  'transpareo:signature': {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    created: '2026-09-13T21:42:31Z',
    verificationMethod: 'https://cdn.test/keys/platform.json',
    proofPurpose: 'assertionMethod',
    proofValue: 'zNotARealSignature',
  },
} as unknown as EpcisDocument

const settle = (): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, 0) })

afterEach(() => {
  resetVerifyCaches()
  host.epcisDocument.set(null)
  host.eventsPending.set(false)
  eventsProofState.set('pending')
  vi.unstubAllGlobals()
})

describe('ensureEventsVerified', () => {
  // Settled, not merely synchronous: the call used to latch
  // a promise that resolved 'absent' a microtask later, and
  // an assertion taken straight after the call could not
  // tell that apart from doing nothing.
  it('holds its verdict while the feed is in flight', async () => {
    host.eventsPending.set(true)
    ensureEventsVerified()
    await settle()
    expect(eventsProofState.peek()).toBe('pending')
  })

  // The passport that never has a feed: a lone document, or
  // a manifest publication whose fetch has already finished
  // without one. 'absent' is the honest answer there.
  it('answers absent when no feed is coming', async () => {
    ensureEventsVerified()
    await vi.waitFor(() => {
      expect(eventsProofState.peek()).toBe('absent')
    })
  })

  // The case the memoisation would have broken: pending
  // first, then the document lands and the verdict comes
  // from reading it. A latched early call would leave
  // 'absent' here, which is why the feed is signed.
  it('judges the document once it lands', async () => {
    host.eventsPending.set(true)
    ensureEventsVerified()
    await settle()
    expect(eventsProofState.peek()).toBe('pending')

    host.epcisDocument.set(SIGNED_FEED)
    host.eventsPending.set(false)
    ensureEventsVerified()

    await vi.waitFor(() => {
      expect(eventsProofState.peek()).not.toBe('pending')
    })

    const verdict = eventsProofState.peek()
    expect(verdict).not.toBe('absent')
    expect(typeof verdict).toBe('object')
  })
})
