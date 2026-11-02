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
 * the unsecured body, its one integrity wrapper removed;
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

// The keys an integrity wrapper sits under, in the order the
// verifiers look for one: `proof` for snapshots, then the
// detached platform signature, `transpareo:signature` on the
// EPCIS events document (namespaced so the file validates
// against the EPCIS 2.0 schema) and `signature` on the
// manifest, the dynamic data and older events documents.
const WRAPPERS = ['proof', 'transpareo:signature', 'signature']

// The unsecured document the suite hashes: the body without
// the first wrapper it carries. Every other key stays in the
// hash, a second wrapper name too, so a key added beside the
// signature breaks it.
export function unsecuredDocument(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const wrapper = WRAPPERS.find((key) => Object.hasOwn(document, key))
  if (wrapper === undefined) return { ...document }
  const { [wrapper]: _wrapper, ...body } = document
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
