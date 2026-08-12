/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * An ecdsa-sd snapshot carries one derived proof per
 * authority (the issuer's, plus the platform's
 * counter-signature). ecdsaVerificationResult folds those
 * into the same VerificationResult the eddsa-jcs path
 * produces, which is what the SPA's per-version state map,
 * the pin gates and both surfaces' aggregate verdicts read.
 *
 * The bug this guards against: dropping the resolved key off
 * each entry, which left every sd entry unpinnable, failed
 * both pin gates on a pinning host page, and stored a red
 * verdict for a snapshot whose proofs had just verified. The
 * pin sets are arguments here, not module-global config, so
 * the standalone widget can pass its own.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ecdsaVerificationResult } from '@/crypto/dispatch'
import { pinGatesOk } from '@/actions'
import { combinedVerdict } from '@/verifier-verdict'
import { config } from '@/config'
import type { EcdsaProofResult } from '@/crypto/dispatch'

const ISSUER_KEY = 'zDnaeIssuerP256Key'
const PLATFORM_KEY = 'zDnaePlatformP256Key'
const ISSUER_METHOD = 'did:web:acme.example#key-2'
const PLATFORM_METHOD = 'did:web:platform.example#key-3'

function proof(
  method: string, keyMultibase: string, verified = true,
): EcdsaProofResult {
  const result = verified
    ? { verified: true, mandatoryCount: 4, nonMandatoryCount: 2 }
    : {
        verified: false, reason: 'base signature does not verify',
        mandatoryCount: 4, nonMandatoryCount: 2
      }
  return {
    verificationMethod: method, proofValue: 'u2V0B', keyMultibase, result
  }
}

function bothProofs(): EcdsaProofResult[] {
  return [
    proof(ISSUER_METHOD, ISSUER_KEY),
    proof(PLATFORM_METHOD, PLATFORM_KEY)
  ]
}

const PINS = {
  pinnedPlatformKeys: [PLATFORM_KEY],
  pinnedIssuerKeys: [ISSUER_KEY]
}

describe('ecdsaVerificationResult', () => {
  it('records one entry per derived proof, keyed on its key', () => {
    const result = ecdsaVerificationResult(bothProofs(), {})
    expect(result.entries.map((e) => e.verificationMethod)).
      toEqual([ISSUER_METHOD, PLATFORM_METHOD])
    expect(result.entries.map((e) => e.keyMultibase)).
      toEqual([ISSUER_KEY, PLATFORM_KEY])
    expect(result.entries.every((e) => e.status === 'verified')).toBe(true)
    expect(result.cryptosuite).toBe('ecdsa-sd-2023')
  })

  it('counts one authority per distinct verified key', () => {
    const result = ecdsaVerificationResult(bothProofs(), {})
    expect(result.verdict).toBe('authentic')
    expect(result.verifiedAuthorityCount).toBe(2)
    expect(result.verifiedEntryCount).toBe(2)
    expect(result.totalEntryCount).toBe(2)
  })

  it('flags the entries whose keys the caller pinned', () => {
    const result = ecdsaVerificationResult(bothProofs(), PINS)
    expect(result.entries.map((e) => e.pinned)).toEqual([false, true])
    expect(result.entries.map((e) => e.issuerPinned)).toEqual([true, false])
  })

  it('takes its pins from the argument, not the SPA config', () => {
    // The standalone widget runs with an unpopulated element
    // config and passes its own pins, so a config read here
    // would silently ignore them.
    expect(config.pinnedPlatformKeys).toBeUndefined()
    const result = ecdsaVerificationResult(bothProofs(), PINS)
    expect(result.entries.some((e) => e.pinned)).toBe(true)
  })

  it('never flags a proof that failed to verify', () => {
    const entries = ecdsaVerificationResult(
      [proof(PLATFORM_METHOD, PLATFORM_KEY, false)], PINS,
    ).entries
    expect(entries[0].pinned).toBe(false)
    expect(entries[0].status).toBe('invalid')
    expect(entries[0].reason).toBe('base signature does not verify')
  })

  it('carries a failed proof into an unauthenticated verdict', () => {
    const result = ecdsaVerificationResult([
      proof(ISSUER_METHOD, ISSUER_KEY),
      proof(PLATFORM_METHOD, PLATFORM_KEY, false)
    ], {})
    expect(result.verdict).toBe('unauthenticated')
    expect(result.verifiedAuthorityCount).toBe(1)
  })

  it('carries the caller mode into the result', () => {
    // The widget verifies strictly; the SPA's failure wording
    // reads the mode back, so a dropped mode mislabels it.
    expect(ecdsaVerificationResult(bothProofs(), {}).mode).toBe('default')
    expect(ecdsaVerificationResult(bothProofs(), { mode: 'strict' }).mode).
      toBe('strict')
  })

  it('reports an unauthenticated verdict for a proofless snapshot', () => {
    const result = ecdsaVerificationResult([], {})
    expect(result.verdict).toBe('unauthenticated')
    expect(result.entries).toEqual([])
  })
})

// The SPA's gates read the pins off the element config, so
// these drive that config rather than the argument: this is
// the path that stored every ecdsa-sd version as failed.
describe('ecdsa-sd entries at the SPA pin gates', () => {
  const mutableConfig = config as {
    pinnedPlatformKeys?: ReadonlyArray<string>
    pinnedIssuerKeys?: ReadonlyArray<string>
  }

  beforeEach(() => {
    mutableConfig.pinnedPlatformKeys = [PLATFORM_KEY]
    mutableConfig.pinnedIssuerKeys = [ISSUER_KEY]
  })

  afterEach(() => {
    delete mutableConfig.pinnedPlatformKeys
    delete mutableConfig.pinnedIssuerKeys
  })

  it('passes both gates when both authorities verified', () => {
    const gates = pinGatesOk(
      ecdsaVerificationResult(bothProofs(), PINS).entries,
    )
    expect(gates.pinOk).toBe(true)
    expect(gates.issuerPinOk).toBe(true)
  })

  it('fails the platform gate when that proof did not verify', () => {
    const entries = ecdsaVerificationResult([
      proof(ISSUER_METHOD, ISSUER_KEY),
      proof(PLATFORM_METHOD, PLATFORM_KEY, false)
    ], PINS).entries
    expect(pinGatesOk(entries).pinOk).toBe(false)
    expect(pinGatesOk(entries).issuerPinOk).toBe(true)
  })

  it('fails both gates when no key resolved', () => {
    const entries = ecdsaVerificationResult(
      bothProofs().map((p) => ({ ...p, keyMultibase: undefined })), PINS,
    ).entries
    expect(pinGatesOk(entries).pinOk).toBe(false)
    expect(pinGatesOk(entries).issuerPinOk).toBe(false)
  })
})

describe('combinedVerdict over an ecdsa-sd result', () => {
  it('reaches authentic once every derived proof verifies', () => {
    const result = ecdsaVerificationResult(bothProofs(), {})
    const verdict = combinedVerdict(result, 'absent', { status: 'ok' })
    expect(verdict.outcome).toBe('authentic')
    expect(verdict.verifiedEntryCount).toBe(2)
  })

  it('stays unauthenticated while one derived proof fails', () => {
    const result = ecdsaVerificationResult([
      proof(ISSUER_METHOD, ISSUER_KEY),
      proof(PLATFORM_METHOD, PLATFORM_KEY, false)
    ], {})
    const verdict = combinedVerdict(result, 'absent', { status: 'ok' })
    expect(verdict.outcome).toBe('unauthenticated')
  })
})
