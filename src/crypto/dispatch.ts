/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Cryptosuite dispatch for a DPP proof. A Data Integrity
 * proof names its `cryptosuite`, so one verifier can carry
 * several suites and pick the path per document:
 *   - eddsa-jcs-2022  -> the whole-document Ed25519 proof
 *     set (multi-authority), unchanged;
 *   - ecdsa-sd-2023   -> the selective-disclosure P-256
 *     path, verifying every derived proof the snapshot
 *     carries (issuer + platform counter-signature) against
 *     the key each one's verificationMethod resolves to.
 * A DPP viewer should verify any proof it is handed, ours
 * or a third party's, and dispatch also eases migration
 * while both suites are in the wild.
 */

import {
  verifySnapshot, type VerificationResult, type VerifyOptions,
  type ProofCarrier, type ProofEntryResult,
} from './verify'
import {
  verifyDerivedProof, type DerivedVerifyResult, ECDSA_SD_2023,
} from './ecdsa-sd'
import { EDDSA_JCS_2022 } from './eddsa-jcs'
import {
  resolveMultikey, warnKeyChangedPastCaches,
  type ResolvedMultikey, type ResolveOptions
} from './did-web'
import { describeError } from '@/errors'

// Resolves a proof's verificationMethod to the issuer's
// P-256 Multikey (the string for pin comparison, the bytes
// for the signature check). Injectable so the dispatch is
// testable without a network fetch. The options carry the
// cache bypass a failed proof retries with.
export type IssuerKeyResolver = (
  method: string, options?: ResolveOptions
) => Promise<ResolvedMultikey>

// One ecdsa-sd derived proof's outcome: the verify result plus
// the key it named, kept so the renderer can show one row per
// proof (issuer + the platform counter-signature).
export interface EcdsaProofResult {
  readonly verificationMethod: string
  readonly proofValue: string
  // The Multikey the verificationMethod resolved to, kept so
  // the renderer can match the proof against the host page's
  // pinned key sets. Absent when resolution failed.
  readonly keyMultibase?: string
  readonly result: DerivedVerifyResult
}

export type DppVerification =
  | {
      readonly cryptosuite: typeof EDDSA_JCS_2022
      readonly result: VerificationResult
    }
  | {
      readonly cryptosuite: typeof ECDSA_SD_2023
      readonly results: ReadonlyArray<EcdsaProofResult>
    }
  | {
      readonly cryptosuite: 'unknown'
      readonly reason: string

      // The suite name the proof declared, when it declared
      // one; absent for a document with no proof at all.
      readonly suite?: string
    }

export interface DispatchOptions {
  readonly verifyOptions?: VerifyOptions
  readonly resolveIssuerKey?: IssuerKeyResolver
}

export async function verifyDpp(
  document: Record<string, unknown>,
  opts: DispatchOptions = {},
): Promise<DppVerification> {
  const proof = firstProof(document)
  if (!proof) {
    return { cryptosuite: 'unknown', reason: 'document has no proof' }
  }
  const cryptosuite = proof.cryptosuite

  if (cryptosuite === EDDSA_JCS_2022) {
    const result = await verifySnapshot(
      document as ProofCarrier, opts.verifyOptions,
    )
    return { cryptosuite: EDDSA_JCS_2022, result }
  }

  if (cryptosuite === ECDSA_SD_2023) {
    return verifyEcdsaSd(document, opts.resolveIssuerKey)
  }

  return {
    cryptosuite: 'unknown',
    reason: `unsupported cryptosuite ${String(cryptosuite)}`,
    suite: String(cryptosuite),
  }
}

export interface SnapshotVerifyOptions extends VerifyOptions {
  // Same injectable P-256 key resolution DispatchOptions
  // offers, so a caller can verify an ecdsa-sd credential
  // without a network fetch.
  readonly resolveIssuerKey?: IssuerKeyResolver
}

// Verify a snapshot under whichever cryptosuite its proof
// declares, and answer in the single VerificationResult
// shape both verification surfaces read: the SPA's
// verification chip and proof modal, and the standalone
// <dpp-verifier> widget. Each keeps its own pin sets (the
// SPA's come off the host element's attributes, the widget's
// off its own), so they are arguments here rather than a
// module-global read - a surface that verifies foreign DPPs
// must not silently inherit another one's pins.
export async function verifySnapshotAnySuite(
  document: Record<string, unknown>,
  opts: SnapshotVerifyOptions = {},
): Promise<VerificationResult> {
  const v = await verifyDpp(document, {
    verifyOptions: opts,
    resolveIssuerKey: opts.resolveIssuerKey,
  })
  if (v.cryptosuite === EDDSA_JCS_2022) {
    return { ...v.result, cryptosuite: v.cryptosuite }
  }
  if (v.cryptosuite === ECDSA_SD_2023) {
    return ecdsaVerificationResult(v.results, opts)
  }
  return {
    entries: [],
    verdict: 'unauthenticated',
    verifiedAuthorityCount: 0,
    totalEntryCount: 0,
    verifiedEntryCount: 0,
    mode: opts.mode ?? 'default',
    unsupportedSuite: v.suite,
  }
}

// Fold the ecdsa-sd derived proofs into the same result the
// eddsa-jcs path returns. Each proof (the issuer's, then the
// platform counter-signature) becomes one entry keyed on the
// P-256 Multikey its verificationMethod resolved to, so a
// renderer draws one authority row + key chip per proof and
// the caller's pin sets have a key to match against.
//
// A pin is only honoured on a proof that verified, mirroring
// verify.ts: the key an unverified entry resolved to says
// nothing about who signed the snapshot.
//
// The caller's mode rides along: authenticity here is always
// all-proofs-must-verify, but a surface that asked for strict
// reads the mode back when it words a failure.
export function ecdsaVerificationResult(
  results: ReadonlyArray<EcdsaProofResult>,
  opts: VerifyOptions,
): VerificationResult {
  const platformPins = opts.pinnedPlatformKeys ?? []
  const issuerPins = opts.pinnedIssuerKeys ?? []
  const entries = results.map((r, index): ProofEntryResult => {
    const ok = r.result.verified
    const key = r.keyMultibase
    const reason = ok ? undefined : r.result.reason
    return {
      index,
      verificationMethod: r.verificationMethod,
      status: ok ? 'verified' : 'invalid',
      proofValue: r.proofValue,
      pinned: ok && key != null && platformPins.includes(key),
      issuerPinned: ok && key != null && issuerPins.includes(key),
      ...(key != null ? { keyMultibase: key } : {}),
      ...(reason ? { reason } : {}),
    }
  })

  // Authorities are counted by resolved key, as in verify.ts:
  // two proofs under one key are one authority.
  const verifiedKeys = new Set<string>()
  let verifiedEntryCount = 0
  for (const e of entries) {
    if (e.status !== 'verified') continue
    if (e.keyMultibase) verifiedKeys.add(e.keyMultibase)
    verifiedEntryCount++
  }

  const authentic = dppIsAuthentic({ cryptosuite: ECDSA_SD_2023, results })
  return {
    entries,
    verdict: authentic ? 'authentic' : 'unauthenticated',
    verifiedAuthorityCount: verifiedKeys.size,
    totalEntryCount: entries.length,
    verifiedEntryCount,
    mode: opts.mode ?? 'default',
    cryptosuite: ECDSA_SD_2023,
  }
}

// True when the document is authentic under whichever
// suite verified it: the aggregate 'authentic' verdict for
// eddsa-jcs, or the derived-proof pass for ecdsa-sd.
export function dppIsAuthentic(v: DppVerification): boolean {
  if (v.cryptosuite === EDDSA_JCS_2022) return v.result.verdict === 'authentic'
  if (v.cryptosuite === ECDSA_SD_2023) {
    return v.results.length > 0 && v.results.every((r) => r.result.verified)
  }
  return false
}

// Verify every ecdsa-sd derived proof the snapshot carries.
// A snapshot is signed twice (issuer + platform counter-
// signature) and a derived view keeps both proofs; each
// verifies against the key its own verificationMethod resolves
// to. Mirrors the eddsa-jcs proof-set loop in verify.ts.
async function verifyEcdsaSd(
  document: Record<string, unknown>,
  resolveIssuerKey: IssuerKeyResolver | undefined,
): Promise<DppVerification> {
  const resolve = resolveIssuerKey ?? resolveIssuerP256Key
  const results = await Promise.all(
    ecdsaProofs(document.proof).map(
      (proof) => verifyOneProof(document, proof, resolve),
    ),
  )
  return { cryptosuite: ECDSA_SD_2023, results }
}

async function verifyOneProof(
  document: Record<string, unknown>,
  proof: Record<string, unknown>,
  resolve: IssuerKeyResolver,
): Promise<EcdsaProofResult> {
  const method = typeof proof.verificationMethod === 'string'
    ? proof.verificationMethod : ''
  const proofValue = typeof proof.proofValue === 'string'
    ? proof.proofValue : ''
  const named = { verificationMethod: method, proofValue }
  if (!method) {
    return { ...named, result: failResult('proof has no verificationMethod') }
  }

  let key: ResolvedMultikey
  try {
    key = await resolve(method)
  } catch (err) {
    const reason = `issuer key resolution failed: ${describeError(err)}`
    return { ...named, result: failResult(reason) }
  }

  const document_ = { ...document, proof }
  let result = await verifyDerivedProof(document_, key.bytes)

  // A proof that fails is as often a stale key document as a
  // bad signature, so re-resolve past every cache once and
  // judge on what the origin serves now. Mirrors the retry
  // the eddsa-jcs path makes in verify.ts.
  if (!result.verified) {
    const fresh = await refetchedKey(method, key, resolve)
    if (fresh) {
      key = fresh
      result = await verifyDerivedProof(document_, fresh.bytes)
    }
  }
  return { ...named, keyMultibase: key.multibase, result }
}

// The key a verificationMethod resolves to past every cache,
// when that differs from the one a proof just failed under.
// An identical key means the caches were honest and there is
// nothing new to verify against.
async function refetchedKey(
  method: string, tried: ResolvedMultikey, resolve: IssuerKeyResolver
): Promise<ResolvedMultikey | undefined> {
  let fresh: ResolvedMultikey
  try {
    fresh = await resolve(method, { bypassCache: true })
  } catch {
    return undefined
  }
  if (fresh.multibase === tried.multibase) return undefined
  warnKeyChangedPastCaches(method)
  return fresh
}

// The ecdsa-sd proofs to verify: the whole `proof` array (a
// two-proof snapshot carries issuer + platform), or the lone
// object form.
function ecdsaProofs(
  proof: unknown,
): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(proof)) return proof.filter(isObject)
  return isObject(proof) ? [proof] : []
}

async function resolveIssuerP256Key(
  method: string, options?: ResolveOptions
): Promise<ResolvedMultikey> {
  const resolved = await resolveMultikey(method, options)
  const { bytes } = resolved

  // P-256 Multikey: multicodec 0x8024 (p256-pub) prefix +
  // 33-byte compressed point.
  if (bytes.length !== 35 || bytes[0] !== 0x80 || bytes[1] !== 0x24) {
    throw new Error('verificationMethod is not a P-256 Multikey')
  }
  return resolved
}

function failResult(reason: string): DerivedVerifyResult {
  return { verified: false, reason, mandatoryCount: 0, nonMandatoryCount: 0 }
}

// The proof to dispatch on: a single proof block, or the
// first entry of a proof set (the eddsa-jcs snapshots
// carry an array; a Data Integrity derived proof is one
// object).
function firstProof(
  document: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const proof = document.proof
  if (Array.isArray(proof)) {
    const first = proof[0]
    return isObject(first) ? first : undefined
  }
  return isObject(proof) ? proof : undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
