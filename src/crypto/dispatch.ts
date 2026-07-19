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
  type ProofCarrier,
} from './verify'
import {
  verifyDerivedProof, type DerivedVerifyResult, ECDSA_SD_2023,
} from './ecdsa-sd'
import { EDDSA_JCS_2022 } from './eddsa-jcs'
import { resolveMultikey } from './did-web'
import { describeError } from '@/errors'

// Resolves a proof's verificationMethod to the issuer's
// raw P-256 key bytes. Injectable so the dispatch is
// testable without a network fetch.
export type IssuerKeyResolver = (method: string) => Promise<Uint8Array>

// One ecdsa-sd derived proof's outcome: the verify result plus
// the key it named, kept so the renderer can show one row per
// proof (issuer + the platform counter-signature).
export interface EcdsaProofResult {
  readonly verificationMethod: string
  readonly proofValue: string
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
  | { readonly cryptosuite: 'unknown', readonly reason: string }

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
  return { verificationMethod: method, proofValue,
    result: await runOneProof(document, proof, method, resolve) }
}

async function runOneProof(
  document: Record<string, unknown>,
  proof: Record<string, unknown>,
  method: string,
  resolve: IssuerKeyResolver,
): Promise<DerivedVerifyResult> {
  if (!method) return failResult('proof has no verificationMethod')
  let key: Uint8Array
  try {
    key = await resolve(method)
  } catch (err) {
    return failResult(`issuer key resolution failed: ${describeError(err)}`)
  }
  return verifyDerivedProof({ ...document, proof }, key)
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

async function resolveIssuerP256Key(method: string): Promise<Uint8Array> {
  const { bytes } = await resolveMultikey(method)
  // P-256 Multikey: multicodec 0x8024 (p256-pub) prefix +
  // 33-byte compressed point.
  if (bytes.length !== 35 || bytes[0] !== 0x80 || bytes[1] !== 0x24) {
    throw new Error('verificationMethod is not a P-256 Multikey')
  }
  return bytes
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
