/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Artefact-kind detection, shared by the SPA host layer
 * and the standalone <dpp-verifier> widget so the two
 * surfaces cannot drift on what inputs exist. Pure
 * data-shape logic with no host/state, DOM, or fetch
 * imports, the same discipline as verifier-verdict.ts.
 *
 * A manifest is tagged `@type: 'DppManifest'` and carries
 * a `versions` array. A snapshot is any other object
 * carrying a proof: flat (eddsa-jcs, proof array on the
 * body) or a Verifiable Credential (ecdsa-sd, body under
 * `credentialSubject`, single DataIntegrityProof).
 * Anything else is unverifiable JSON.
 */

export type ArtefactKind = 'manifest' | 'snapshot' | 'unknown'

export function detectArtefact(data: unknown): ArtefactKind {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return 'unknown'
  }
  const o = data as Record<string, unknown>
  if (o['@type'] === 'DppManifest' || Array.isArray(o.versions)) {
    return 'manifest'
  }
  return hasProof(o) ? 'snapshot' : 'unknown'
}

// A proof is a single DataIntegrityProof object or a
// non-empty array of them.
function hasProof(o: Record<string, unknown>): boolean {
  const proof = o.proof
  if (Array.isArray(proof)) return proof.length > 0
  return proof !== null && typeof proof === 'object'
}

// A VC-shaped snapshot keeps its body under
// `credentialSubject`; unwrap it to the flat shape the
// eddsa-jcs snapshot already has, normalizing the proof
// to an array, so one reader serves both. A flat snapshot
// passes through unchanged.
export function snapshotBody(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const subject = raw.credentialSubject
  if (subject === null || typeof subject !== 'object') return raw
  const proof = raw.proof
  const proofs = Array.isArray(proof) ? proof : proof ? [proof] : []
  return { ...(subject as Record<string, unknown>), proof: proofs }
}
