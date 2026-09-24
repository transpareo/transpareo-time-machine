/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How the dynamic-data document is judged, and when its
 * values may paint.
 *
 * The document is signed with the platform key in the
 * manifest's single-signature scheme, so the manifest's
 * verifier checks it. Before that it must name the passport
 * it is served for: a signed document of another passport
 * verifies perfectly and says nothing about this one.
 *
 * Its verdict is its own. The version stays verified on the
 * snapshot's proofs; the live values paint only once their
 * document clears the same acceptance policy as the events
 * feed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/crypto/verify', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/crypto/verify')>(),
  verifyManifestSignature: vi.fn(),
}))

import { verifyManifestSignature } from '@/crypto/verify'
import type { ProofEntryResult } from '@/crypto/verify'
import type { DppDynamicData, DppManifest } from '@/archive'
import * as host from '@/host'
import {
  ensureDynamicDataVerified, resetVerifyCaches, liveDataIsShowable,
} from '@/actions'
import { dynamicDataProofState } from '@/state'
import { config } from '@/config'

const SIGNATURE = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: '2026-09-24T08:15:00Z',
  verificationMethod: 'https://cdn.test/keys/platform.json',
  proofPurpose: 'assertionMethod',
  proofValue: 'zNotARealSignature',
}

const DOC: DppDynamicData = {
  '@type': 'DppDynamicData',
  code: 'dpp-a',
  updatedAt: '2026-09-24T08:15:00Z',
  values: [{ propertyID: 'stateOfCharge', value: 81 }],
  signature: SIGNATURE,
}

const VERIFIED: ProofEntryResult = {
  index: 0,
  verificationMethod: SIGNATURE.verificationMethod,
  status: 'verified',
  proofValue: SIGNATURE.proofValue,
  pinned: false,
  issuerPinned: false,
  keyMultibase: 'zPlatformKey',
}

const mutableConfig = config as {
  pinnedPlatformKeys?: ReadonlyArray<string>
}

function boot(doc: DppDynamicData | null): void {
  host.manifest.set({ code: 'dpp-a' } as DppManifest)
  host.dynamicData.set(doc)
}

afterEach(() => {
  resetVerifyCaches()
  host.manifest.set(null)
  host.dynamicData.set(null)
  dynamicDataProofState.set('pending')
  delete mutableConfig.pinnedPlatformKeys
  vi.mocked(verifyManifestSignature).mockReset()
})

describe('ensureDynamicDataVerified', () => {
  it('checks the signature in the manifest scheme', async () => {
    vi.mocked(verifyManifestSignature).mockResolvedValue(VERIFIED)
    boot(DOC)

    ensureDynamicDataVerified()

    await vi.waitFor(() => {
      expect(dynamicDataProofState.peek()).toEqual(VERIFIED)
    })
    expect(verifyManifestSignature).toHaveBeenCalledWith(DOC, undefined)
  })

  // Replay across passports: the signature holds, the
  // document is still not this passport's.
  it('rejects a document that names another passport', async () => {
    vi.mocked(verifyManifestSignature).mockResolvedValue(VERIFIED)
    boot({ ...DOC, code: 'dpp-b' })

    ensureDynamicDataVerified()

    await vi.waitFor(() => {
      const state = dynamicDataProofState.peek()
      expect(state).toMatchObject({ status: 'invalid' })
    })
    expect(verifyManifestSignature).not.toHaveBeenCalled()
  })

  it('reads an unsigned document as absent', async () => {
    vi.mocked(verifyManifestSignature).mockResolvedValue(null)
    boot({ ...DOC, signature: undefined })

    ensureDynamicDataVerified()

    await vi.waitFor(() => {
      expect(dynamicDataProofState.peek()).toBe('absent')
    })
  })

  // A throw means hashing blew up, which is a real failure.
  it('fails closed when the check throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(verifyManifestSignature).mockRejectedValue(new Error('boom'))
    boot(DOC)

    ensureDynamicDataVerified()

    await vi.waitFor(() => {
      expect(dynamicDataProofState.peek()).toMatchObject({
        status: 'invalid',
      })
    })
    warn.mockRestore()
  })

  it('waits for the document', async () => {
    boot(null)

    ensureDynamicDataVerified()
    await new Promise((r) => { setTimeout(r, 0) })

    expect(dynamicDataProofState.peek()).toBe('pending')
    expect(verifyManifestSignature).not.toHaveBeenCalled()
  })

  it('judges one document once', async () => {
    vi.mocked(verifyManifestSignature).mockResolvedValue(VERIFIED)
    boot(DOC)

    ensureDynamicDataVerified()
    ensureDynamicDataVerified()

    await vi.waitFor(() => {
      expect(dynamicDataProofState.peek()).toEqual(VERIFIED)
    })
    expect(verifyManifestSignature).toHaveBeenCalledTimes(1)
  })
})

// A reboot onto another passport while the check is in
// flight: the verdict belongs to the previous passport and
// must not land on the next one.
describe('a reboot during the check', () => {
  it('keeps the old verdict out of the new passport', async () => {
    let resolve!: (v: ProofEntryResult) => void
    vi.mocked(verifyManifestSignature).mockReturnValue(
      new Promise((r) => { resolve = r }),
    )
    boot(DOC)
    ensureDynamicDataVerified()

    vi.stubGlobal('window', { location: { href: 'https://page.test/' } })
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await host.bootFrom('https://cdn.test/b/manifest.json')
    resolve(VERIFIED)
    await new Promise((r) => { setTimeout(r, 0) })

    expect(dynamicDataProofState.peek()).toBe('pending')
    warn.mockRestore()
    vi.unstubAllGlobals()
  })
})

describe('liveDataIsShowable', () => {
  it('holds the values back while the check runs', () => {
    expect(liveDataIsShowable('pending')).toBe(false)
  })

  it('shows values whose signature verified', () => {
    expect(liveDataIsShowable(VERIFIED)).toBe(true)
  })

  it('hides values whose signature failed', () => {
    expect(liveDataIsShowable({ ...VERIFIED, status: 'invalid' }))
      .toBe(false)
  })

  // Same policy as the events feed: a build that pins the
  // platform key accepts no unsigned document.
  it('follows the pin policy for an unsigned document', () => {
    expect(liveDataIsShowable('absent')).toBe(true)
    mutableConfig.pinnedPlatformKeys = ['zPinned']
    expect(liveDataIsShowable('absent')).toBe(false)
  })
})
