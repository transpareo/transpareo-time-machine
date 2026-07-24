/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Version-chain content hashes, the single implementation
 * every party must agree on: the seed that stamps a
 * manifest's hashValue and each snapshot's priorVersionHash,
 * the SPA's chain walk (actions.ts), and the standalone
 * verifier widget (verifier-chain.ts). One module so producer
 * and consumers cannot drift apart.
 *
 * A flat eddsa-jcs snapshot chains on the SHA-256 of its
 * JCS-canonical body (proof removed). An ecdsa-sd snapshot is
 * a Verifiable Credential and chains on the SHA-256 over its
 * RDFC canonical statements, which equals the issuer's
 * mandatory-statements hash because the public view reveals
 * exactly the mandatory statements. A migrated DPP's history
 * can cross that boundary, so the hash is chosen per snapshot.
 */

import { canonicalize } from './jcs'
import {
  canonicalize as canonicalizeRdfc, hashNQuads,
} from './rdfc'
import { DPP_CONTEXTS } from './dpp-contexts'
import { unsecuredDocument } from './eddsa-jcs'

// A snapshot-ish document. The hashing only reads whether it
// carries a `proof` (stripped before hashing) and a
// `credentialSubject` (the ecdsa-sd VC marker), so the type
// stays minimal and free of the archive/proof types, keeping
// this module importable by the seed (no `@/` deps).
type HashableDoc = { readonly proof?: unknown }

function asRecord(doc: HashableDoc): Record<string, unknown> {
  return doc as unknown as Record<string, unknown>
}

export async function sha256Utf8(text: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

// SHA-256 of the JCS-canonical unsecured document (the body
// with its proof / signature removed). Shared by every proof
// entry, then combined with each entry's own proof-config
// hash to form that entry's hashData.
export async function hashDocument(
  document: HashableDoc,
): Promise<Uint8Array> {
  return sha256Utf8(canonicalize(unsecuredDocument(asRecord(document))))
}

// Hex form of hashDocument: a flat eddsa-jcs snapshot's chain
// hash.
export async function hexHashOfSnapshotBody(
  snapshot: HashableDoc,
): Promise<string> {
  return hexOf(await hashDocument(snapshot))
}

// The hash a snapshot contributes to the version chain, per
// its format: the RDFC statements hash for a VC-shaped
// ecdsa-sd snapshot, the JCS body hash for a flat eddsa-jcs
// one. The walker must pick per prior-version format, since a
// chain can cross the cryptosuite boundary mid-history.
export async function hexChainHashOfSnapshot(
  snapshot: HashableDoc,
): Promise<string> {
  const doc = asRecord(snapshot)
  if (doc.credentialSubject === undefined) {
    return hexHashOfSnapshotBody(snapshot)
  }
  const unsecured = { ...doc }
  delete unsecured.proof
  const nquads = await canonicalizeRdfc(unsecured, {
    contexts: DPP_CONTEXTS,
  })
  return hexOf(await hashNQuads(nquads))
}

function hexOf(digest: Uint8Array): string {
  let out = ''
  for (const b of digest) out += b.toString(16).padStart(2, '0')
  return out
}
