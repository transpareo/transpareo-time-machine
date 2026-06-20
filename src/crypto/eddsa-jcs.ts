/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shared pieces of the W3C eddsa-jcs-2022 Data Integrity
 * construction, used by both the in-browser verifier
 * (src/crypto/verify.ts) and the seed-side signer
 * (scripts/seed/signing.ts) so the two never drift.
 *
 * The signature covers
 *   hashData = SHA-256(JCS(proofConfig))
 *            || SHA-256(JCS(document))
 * with the proof-config hash FIRST (per the spec; this is
 * the opposite order to eddsa-rdfc-2022). The document is
 * the unsecured body, its `proof` / `signature` removed;
 * the proofConfig is the proof options minus `proofValue`,
 * carrying the document's `@context`.
 */

export const EDDSA_JCS_2022 = 'eddsa-jcs-2022'

// The proof configuration the suite hashes: the proof
// options without `proofValue`, carrying the document's
// `@context`. Key order is irrelevant (JCS sorts the
// output), so callers may pass the options in any order.
// A document without an `@context` yields a config without
// one, rather than binding `undefined`.
export function proofConfig(
  proof: Record<string, unknown>,
  context: unknown,
): Record<string, unknown> {
  const { proofValue: _proofValue, ...options } = proof
  if (context === undefined) return { ...options }
  return { '@context': context, ...options }
}

// The unsecured document the suite hashes: the body with
// its integrity wrapper (`proof` for snapshots, `signature`
// for manifests) removed. `@context` and every other field
// stay, so the hash covers the full payload.
export function unsecuredDocument(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const { proof: _proof, signature: _signature, ...body } = document
  return body
}

// Join the two SHA-256 digests into the signing input.
export function joinHashes(
  proofConfigHash: Uint8Array, documentHash: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(proofConfigHash.length + documentHash.length)
  out.set(proofConfigHash, 0)
  out.set(documentHash, proofConfigHash.length)
  return out
}
