// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * When the events feed's signature is judged, and what the
 * timeline shows of the feed.
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
 *
 * The feed must name the passport it is served for before
 * its signature counts: a signed feed of another passport
 * verifies perfectly and says nothing about this one. The
 * timeline shows the feed's events once its verdict is in
 * and clears the policy the live values clear, and holds
 * its strip's space until then.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

vi.mock('@/crypto/verify', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/crypto/verify')>(),
  verifyManifestSignature: vi.fn(),
}))

import { verifyManifestSignature } from '@/crypto/verify'
import type { ProofEntryResult } from '@/crypto/verify'
import type { DppManifest } from '@/archive'
import * as host from '@/host'
import {
  eventsProofState, events, eventsPending, resetBootState,
} from '@/state'
import { ensureEventsVerified, resetVerifyCaches } from '@/actions'
import { config } from '@/config'
import type { EpcisDocument } from '@/epcis'

const SIGNATURE = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: '2026-09-13T21:42:31Z',
  verificationMethod: 'https://cdn.test/keys/platform.json',
  proofPurpose: 'assertionMethod',
  proofValue: 'zNotARealSignature',
}

// A feed carrying a signature block, so a verdict read off
// the document is an entry object and can never be mistaken
// for the 'absent' a missing document produces.
const SIGNED_FEED = {
  type: 'EPCISDocument',
  epcisBody: { eventList: [] },
  'transpareo:signature': SIGNATURE,
} as unknown as EpcisDocument

const VERIFIED: ProofEntryResult = {
  index: 0,
  verificationMethod: SIGNATURE.verificationMethod,
  status: 'verified',
  proofValue: SIGNATURE.proofValue,
  pinned: false,
  issuerPinned: false,
  keyMultibase: 'zPlatformKey',
}

const INVALID: ProofEntryResult = { ...VERIFIED, status: 'invalid' }

const mutableConfig = config as {
  pinnedPlatformKeys?: ReadonlyArray<string>
}

// A feed of one published event, naming its passport under
// whichever key the fields given carry.
function feed(names: Record<string, unknown> = {}): EpcisDocument {
  return {
    type: 'EPCISDocument',
    ...names,
    epcisBody: {
      eventList: [{
        type: 'ObjectEvent',
        eventTime: '2026-01-01T00:00:00Z',
        'transpareo:dppEventId': 'pub-1',
        'transpareo:eventType': 'published',
        'transpareo:versionNumber': 1,
      }],
    },
    'transpareo:signature': SIGNATURE,
  } as unknown as EpcisDocument
}

// The feed has landed beside the manifest of passport dpp-a.
function land(doc: EpcisDocument): void {
  host.manifest.set({ code: 'dpp-a' } as DppManifest)
  host.epcisDocument.set(doc)
  host.eventsPending.set(false)
}

// Judge the landed feed and settle its verdict.
async function judge(doc: EpcisDocument): Promise<unknown> {
  land(doc)
  ensureEventsVerified()
  await vi.waitFor(() => {
    expect(eventsProofState.peek()).not.toBe('pending')
  })
  return eventsProofState.peek()
}

const settle = (): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, 0) })

beforeEach(() => {
  vi.mocked(verifyManifestSignature).mockResolvedValue(VERIFIED)
})

afterEach(() => {
  resetVerifyCaches()
  resetBootState()
  host.manifest.set(null)
  host.epcisDocument.set(null)
  host.eventsPending.set(false)
  delete mutableConfig.pinnedPlatformKeys
  vi.mocked(verifyManifestSignature).mockReset()
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

describe('the passport a feed names', () => {
  it('accepts a feed naming this passport', async () => {
    expect(await judge(feed({ 'transpareo:code': 'dpp-a' })))
      .toEqual(VERIFIED)
  })

  // Replay across passports: the signature holds, the feed
  // is still not this passport's.
  it('rejects a feed naming another passport', async () => {
    const verdict = await judge(feed({ 'transpareo:code': 'dpp-b' }))
    expect(verdict).toMatchObject({ status: 'invalid' })
    expect(verifyManifestSignature).not.toHaveBeenCalled()
  })

  // Feeds signed before the key was namespaced name the
  // passport under a bare `code`, as they carry a bare
  // `signature`.
  it('reads the bare code of an older feed', async () => {
    expect(await judge(feed({ code: 'dpp-b' })))
      .toMatchObject({ status: 'invalid' })
    expect(await judgeAgain(feed({ code: 'dpp-a' }))).toEqual(VERIFIED)
  })

  // Older feeds name no passport; the signature is all
  // there is to check.
  it('holds a feed naming no passport to its signature', async () => {
    expect(await judge(feed())).toEqual(VERIFIED)
  })
})

describe('the events the timeline shows', () => {
  it('holds the events back while the verdict is out', () => {
    land(feed())
    expect(events()).toEqual([])
  })

  it('shows the events once the verdict clears', async () => {
    await judge(feed())
    expect(events().map((e) => e.id)).toEqual(['pub-1'])
  })

  // The proof dialog still reports the feed's verdict.
  it('shows no event from a feed whose signature fails', async () => {
    vi.mocked(verifyManifestSignature).mockResolvedValue(INVALID)
    expect(await judge(feed())).toEqual(INVALID)
    expect(events()).toEqual([])
  })

  it('shows no event from a feed naming another passport', async () => {
    await judge(feed({ 'transpareo:code': 'dpp-b' }))
    expect(events()).toEqual([])
  })

  // The live values' policy: an unpinned build tolerates an
  // unsigned feed, a pinned one accepts none.
  it('follows the pin policy for an unsigned feed', async () => {
    vi.mocked(verifyManifestSignature).mockResolvedValue(null)
    await judge(feed())
    expect(events()).toHaveLength(1)

    mutableConfig.pinnedPlatformKeys = ['zPinned']
    expect(await judgeAgain(feed())).toBe('absent')
    expect(events()).toEqual([])
  })

  it('forgets the feed on a reboot', async () => {
    await judge(feed())
    resetBootState()
    expect(events()).toEqual([])
  })
})

// The timeline holds its strip's space on this, so it must
// not let go between the feed landing and its verdict.
describe('eventsPending', () => {
  it('holds while the feed is in flight', () => {
    host.eventsPending.set(true)
    expect(eventsPending()).toBe(true)
  })

  it('holds while the landed feed is judged', () => {
    land(feed())
    expect(eventsPending()).toBe(true)
  })

  it('lets go once the verdict is in', async () => {
    vi.mocked(verifyManifestSignature).mockResolvedValue(INVALID)
    await judge(feed())
    expect(eventsPending()).toBe(false)
  })

  it('lets go when no feed came', () => {
    expect(eventsPending()).toBe(false)
  })
})

// A second feed in one test: forget the first verdict, as a
// reboot does, and judge again.
function judgeAgain(doc: EpcisDocument): Promise<unknown> {
  resetVerifyCaches()
  resetBootState()
  return judge(doc)
}
