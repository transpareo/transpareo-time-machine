/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ecdsa-sd-2023 derived-proof verification (W3C Data
 * Integrity ECDSA Cryptosuites). A derived proof reveals
 * the mandatory statements plus whichever selectively-
 * disclosable statements a reader is entitled to; this
 * confirms every revealed statement was signed by the
 * issuer, without the withheld ones being present.
 *
 * Algorithm (spec section "Verify Derived Proof"):
 *   1. proofValue: multibase 'u' base64url -> CBOR
 *      tag(0xd95d01) -> [ baseSignature, publicKey,
 *      signatures, labelMap, mandatoryIndexes ].
 *   2. proofHash = SHA-256 of the canonical proof options.
 *   3. Canonicalize the document with the label map
 *      restated, giving ordered N-Quads; split them into
 *      mandatory / non-mandatory by mandatoryIndexes.
 *   4. mandatoryHash = SHA-256 of the mandatory N-Quads.
 *   5. Verify baseSignature over
 *      proofHash || publicKey || mandatoryHash against the
 *      issuer key; verify each non-mandatory N-Quad's
 *      signature against the proof-scoped publicKey.
 *
 * The issuer key is resolved by the caller (from the
 * proof's verificationMethod) and passed in, so this
 * module stays free of network and DID plumbing.
 */

import { decodeMultibaseBase64url, encodeBase64url } from './base64url'
import { decodeCbor, type CborValue } from './cbor'
import { importP256PublicKey, verifyP256 } from './p256'
import { canonicalize, hashNQuads } from './rdfc'
import { DPP_CONTEXTS } from './dpp-contexts'

export const ECDSA_SD_2023 = 'ecdsa-sd-2023'

// CBOR tag prefix bytes 0xd9 0x5d 0x01 mark a derived
// proof value (0x5d01 is the tag number the decoder reads).
const DERIVED_TAG = 0x5d01

interface DerivedProof {
  readonly baseSignature: Uint8Array
  readonly publicKey: Uint8Array
  readonly signatures: readonly Uint8Array[]
  readonly labelMap: ReadonlyMap<number, Uint8Array>
  readonly mandatoryIndexes: readonly number[]
}

export interface DerivedVerifyResult {
  readonly verified: boolean
  readonly reason?: string
  // The document with its proof block removed: exactly the
  // statements this derived view disclosed, all verified.
  readonly revealedDocument?: Record<string, unknown>
  readonly mandatoryCount: number
  readonly nonMandatoryCount: number
}

export async function verifyDerivedProof(
  document: Record<string, unknown>,
  issuerPublicKey: Uint8Array,
): Promise<DerivedVerifyResult> {
  try {
    return await runVerify(document, issuerPublicKey)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { verified: false, reason, mandatoryCount: 0, nonMandatoryCount: 0 }
  }
}

async function runVerify(
  document: Record<string, unknown>,
  issuerPublicKey: Uint8Array,
): Promise<DerivedVerifyResult> {
  const proof = requireProof(document)
  const derived = parseDerivedProofValue(requireString(proof.proofValue))

  const proofHash = await hashNQuads(
    await canonicalize(proofOptions(proof, document), { contexts: DPP_CONTEXTS }),
  )

  const unsecured = { ...document }
  delete unsecured.proof
  const nquads = await canonicalize(unsecured, {
    labelMap: restateLabelMap(derived.labelMap), contexts: DPP_CONTEXTS,
  })

  const { mandatory, nonMandatory } = split(nquads, derived.mandatoryIndexes)
  if (derived.signatures.length !== nonMandatory.length) {
    return fail(
      `signature count ${derived.signatures.length} `
      + `does not match ${nonMandatory.length} disclosed statements`,
      mandatory.length, nonMandatory.length,
    )
  }

  const mandatoryHash = await hashNQuads(mandatory)
  const issuerKey = await importP256PublicKey(issuerPublicKey)
  const baseData = concat(proofHash, derived.publicKey, mandatoryHash)
  if (!await verifyP256(issuerKey, derived.baseSignature, baseData)) {
    return fail(
      'base signature does not verify against the issuer key',
      mandatory.length, nonMandatory.length,
    )
  }

  const proofScopedKey = await importP256PublicKey(derived.publicKey)
  for (let i = 0; i < nonMandatory.length; i++) {
    const message = new TextEncoder().encode(nonMandatory[i])
    if (!await verifyP256(proofScopedKey, derived.signatures[i], message)) {
      return fail(
        `disclosed statement ${i} does not verify`,
        mandatory.length, nonMandatory.length,
      )
    }
  }

  return {
    verified: true,
    revealedDocument: unsecured,
    mandatoryCount: mandatory.length,
    nonMandatoryCount: nonMandatory.length,
  }
}

// Decode and structurally validate a derived proofValue.
export function parseDerivedProofValue(proofValue: string): DerivedProof {
  const decoded = decodeCbor(decodeMultibaseBase64url(proofValue))
  const tag = asTag(decoded)
  if (tag.tag !== DERIVED_TAG) {
    throw new Error(`not a derived proof (tag 0x${tag.tag.toString(16)})`)
  }
  const parts = asArray(tag.value)
  if (parts.length !== 5) {
    throw new Error(`derived proof has ${parts.length} components, expected 5`)
  }
  return {
    baseSignature: asBytes(parts[0], 64),
    publicKey: asBytes(parts[1]),
    signatures: asArray(parts[2]).map((s) => asBytes(s, 64)),
    labelMap: asIntByteMap(parts[3], 32),
    mandatoryIndexes: asArray(parts[4]).map(asIndex),
  }
}

// The proof options the proofHash is taken over: the proof
// block without its value, carrying the document context
// so the canonical form binds the same vocabulary.
function proofOptions(
  proof: Record<string, unknown>,
  document: Record<string, unknown>,
): Record<string, unknown> {
  const { proofValue: _drop, ...options } = proof
  return { '@context': document['@context'], ...options }
}

// Restate the compressed integer->bytes label map as the
// c14n-label -> HMAC-label map the canonicalizer applies:
// key 'c14n{k}', value 'u{base64url(v)}' (the exact label
// text the issuer canonicalized over).
function restateLabelMap(
  compressed: ReadonlyMap<number, Uint8Array>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of compressed) {
    out.set(`c14n${k}`, 'u' + encodeBase64url(v))
  }
  return out
}

function split(
  nquads: readonly string[], mandatoryIndexes: readonly number[],
): { mandatory: string[], nonMandatory: string[] } {
  const wanted = new Set<number>()
  for (const i of mandatoryIndexes) {
    if (i >= nquads.length) {
      throw new Error(`mandatory index ${i} out of range`)
    }
    if (wanted.has(i)) throw new Error(`duplicate mandatory index ${i}`)
    wanted.add(i)
  }
  const mandatory: string[] = []
  const nonMandatory: string[] = []
  for (let i = 0; i < nquads.length; i++) {
    (wanted.has(i) ? mandatory : nonMandatory).push(nquads[i])
  }
  return { mandatory, nonMandatory }
}

function requireProof(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const proof = document.proof
  if (proof === null || typeof proof !== 'object' || Array.isArray(proof)) {
    throw new Error('document has no single proof block')
  }
  const p = proof as Record<string, unknown>
  if (p.type !== 'DataIntegrityProof') {
    throw new Error(`unexpected proof type ${String(p.type)}`)
  }
  if (p.cryptosuite !== ECDSA_SD_2023) {
    throw new Error(`unexpected cryptosuite ${String(p.cryptosuite)}`)
  }
  return p
}

function fail(
  reason: string, mandatoryCount: number, nonMandatoryCount: number,
): DerivedVerifyResult {
  return { verified: false, reason, mandatoryCount, nonMandatoryCount }
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function asTag(value: CborValue): { tag: number, value: CborValue } {
  if (value !== null && typeof value === 'object' && 'tag' in value) {
    return value as { tag: number, value: CborValue }
  }
  throw new Error('proof value is not a CBOR tag')
}

function asArray(value: CborValue): readonly CborValue[] {
  if (Array.isArray(value)) return value
  throw new Error('expected a CBOR array')
}

function asBytes(value: CborValue, length?: number): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error('expected a CBOR byte string')
  }
  if (length !== undefined && value.length !== length) {
    throw new Error(`expected ${length} bytes, got ${value.length}`)
  }
  return value
}

function asIntByteMap(
  value: CborValue, byteLength: number,
): Map<number, Uint8Array> {
  if (!(value instanceof Map)) throw new Error('expected a CBOR map')
  const out = new Map<number, Uint8Array>()
  for (const [k, v] of value) out.set(asIndex(k), asBytes(v, byteLength))
  return out
}

function asIndex(value: CborValue): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('expected a non-negative integer')
  }
  return value
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('proofValue is not a string')
  return value
}
