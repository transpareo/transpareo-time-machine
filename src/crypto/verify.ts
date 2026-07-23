/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * In-browser Ed25519 proof verification for the
 * multi-authority DPP snapshot proof set, using the W3C
 * eddsa-jcs-2022 Data Integrity cryptosuite.
 *
 * Per-entry algorithm (see ./eddsa-jcs for the shared
 * construction):
 *   1. Build the proof configuration: the entry's options
 *      (type, cryptosuite, created, verificationMethod,
 *      proofPurpose) minus proofValue, carrying the
 *      document's `@context`. JCS-canonicalize, SHA-256.
 *   2. JCS-canonicalize the snapshot with `proof` removed,
 *      SHA-256.
 *   3. hashData = proofConfigHash || documentHash.
 *   4. Resolve `verificationMethod` to a public key: a
 *      did:web method maps to its did.json and the key is
 *      selected from the verificationMethod array by
 *      fragment; an http(s) or relative URL is fetched and
 *      its publicKeyMultibase read directly.
 *   5. Decode `proofValue` (multibase base58 "z" prefix +
 *      64-byte signature) and crypto.subtle.verify(
 *      Ed25519, pubKey, sig, hashData).
 *
 * Because the proof config binds each entry's own
 * verificationMethod, every entry carries an independent
 * signature (unlike the older reduced profile, where the
 * aliases of one authority shared a single signature).
 *
 * The proof set has five entries today: three issuer
 * aliases (HTTPS host, did:web, HTTPS CDN fallback) and
 * two platform aliases (HTTPS host, did:web). The three
 * issuer aliases resolve to one key, the two platform
 * aliases to another; the CDN fallback keeps the issuer
 * side verifiable after the issuer's own hosts terminate.
 *
 * Aggregate rules:
 *   - Default (any-issuer-and-any-Transpareo): a snapshot
 *     is authentic when entries verifying under at least
 *     two distinct keys are present (one issuer key, one
 *     platform key). Aliases that fail to resolve (offline
 *     did host, dead CDN) are tolerated as long as one per
 *     authority verifies.
 *   - Strict (all-N): every entry must verify. Opt-in via
 *     { mode: 'strict' } for verifier surfaces that want
 *     the full reachability picture rather than the
 *     two-of-two summary.
 *
 * Authorities are counted by resolved public key, so the
 * verdict survives both renaming of resolution hosts and
 * the per-entry signatures of the standard suite.
 */

import { canonicalize } from './jcs'
import {
  canonicalize as canonicalizeRdfc, hashNQuads,
} from './rdfc'
import { DPP_CONTEXTS } from './dpp-contexts'
import { decodeMultibaseBase58 } from './multibase'
import { proofConfig, unsecuredDocument, joinHashes } from './eddsa-jcs'
import { resolveMultikey } from './did-web'
import { asBuffer } from './buffer'
import type { ManifestSignature } from '@/archive'
import { describeError } from '@/errors'

export type ProofEntryStatus =
  | 'pending'
  | 'verified'
  | 'unreachable'
  | 'invalid'

export interface ProofEntryResult {
  readonly index: number
  readonly verificationMethod: string
  readonly status: ProofEntryStatus
  // The entry's signature value, kept on the result for
  // display. Each entry is signed independently now, so it
  // no longer identifies an authority; grouping is by the
  // resolved key (`keyMultibase`), or by the
  // verificationMethod base URL for entries that didn't
  // resolve.
  readonly proofValue: string
  // The resolved public key (multibase z58 Multikey) when
  // the entry verified, absent otherwise. Authorities are
  // counted by this: distinct verified keys are distinct
  // authorities.
  readonly keyMultibase?: string
  // True iff verification succeeded AND the resolved
  // public key matches one of the caller-supplied
  // pinnedPlatformKeys. When the option is unset, this
  // is always false (no pinning policy is in effect).
  readonly pinned: boolean
  // Same flag for the pinnedIssuerKeys set: verification
  // succeeded under one of the issuer's declared keys
  // (BYOK or platform-managed alike). False when the
  // option is unset.
  readonly issuerPinned: boolean
  // Short reason for failures, shown next to the entry
  // row in the proof modal. Absent on pending/verified.
  readonly reason?: string
}

export type AggregateVerdict =
  | 'pending'
  | 'authentic'
  | 'unauthenticated'

export interface VerificationResult {
  readonly entries: ReadonlyArray<ProofEntryResult>
  readonly verdict: AggregateVerdict
  // Number of distinct public keys that at least one
  // entry verified under. The default rule is authentic
  // <=> this is >= 2 (one issuer key + one platform key);
  // strict mode tightens it to require every entry to
  // verify.
  readonly verifiedAuthorityCount: number
  // Total entries the snapshot carried, vs how many of
  // them verified. Surfaced so the modal can show "5 of
  // 5 verified" when everything resolved, "3 of 5
  // verified" when the did:web hosts are offline, etc.
  readonly totalEntryCount: number
  readonly verifiedEntryCount: number
  // The mode this result was computed under. Strict
  // mode requires totalEntryCount === verifiedEntryCount;
  // the default rule requires verifiedAuthorityCount >= 2.
  readonly mode: VerificationMode

  // The Data Integrity cryptosuite that produced this
  // result (`eddsa-jcs-2022` or `ecdsa-sd-2023`), stamped
  // by the dispatcher so the proof modal can label which
  // suite the active snapshot was verified under. Absent
  // when a single-suite verifier is called directly.
  readonly cryptosuite?: string
}

export type VerificationMode = 'default' | 'strict'

export interface VerifyOptions {
  // 'default' (any-issuer-and-any-Transpareo): authentic
  // as long as one entry per signature group verifies.
  // 'strict' (all-five): every entry must verify.
  readonly mode?: VerificationMode
  // Optional pinned platform key set (multibase z58
  // Ed25519 Multikeys, the same encoding used in
  // publicKeyMultibase). Several keys because rotation
  // retires-but-keeps platform keys: snapshots signed
  // under an older version must still count as pinned.
  // When set, entries whose resolved public key matches
  // any pin are flagged pinned=true on their
  // ProofEntryResult; the caller can then enforce a
  // "must include a pinned key" policy on top of the
  // aggregate verdict (see the <dpp-verifier> element).
  // Unpinned: every entry is verified against whatever
  // key its verificationMethod URL returns, so any
  // keypair the manifest references is accepted.
  readonly pinnedPlatformKeys?: ReadonlyArray<string>
  // Optional pinned issuer key set (same encoding). The
  // issuer's declared signing keys; under BYOK these are
  // the customer's own registered public keys. Entries
  // verifying under one are flagged issuerPinned=true so
  // a host page can require the issuer proof to come from
  // the declared keys, not just any key the snapshot
  // references.
  readonly pinnedIssuerKeys?: ReadonlyArray<string>
}

export interface ProofCarrier {
  readonly proof?: ReadonlyArray<ManifestSignature>
}

export async function verifySnapshot(
  snapshot: ProofCarrier,
  opts: VerifyOptions = {},
): Promise<VerificationResult> {
  const mode = opts.mode ?? 'default'
  const proofs = snapshot.proof ?? []
  if (proofs.length === 0) {
    return {
      entries: [],
      verdict: 'unauthenticated',
      verifiedAuthorityCount: 0,
      totalEntryCount: 0,
      verifiedEntryCount: 0,
      mode,
    }
  }

  const documentHash = await hashDocument(snapshot)
  const context = (snapshot as Record<string, unknown>)['@context']
  const entries = await Promise.all(
    proofs.map((p, i) =>
      verifyEntry(
        p, i, documentHash, context,
        opts.pinnedPlatformKeys, opts.pinnedIssuerKeys,
      ),
    ),
  )

  // Count authorities by resolved key: each distinct key a
  // verified entry resolved under is one authority, and one
  // verified entry per key is enough for its contribution
  // to the aggregate.
  const verifiedKeys = new Set<string>()
  let verifiedEntryCount = 0
  for (const e of entries) {
    if (e.status === 'verified') {
      if (e.keyMultibase) verifiedKeys.add(e.keyMultibase)
      verifiedEntryCount++
    }
  }

  const verifiedAuthorityCount = verifiedKeys.size
  const totalEntryCount = entries.length
  const verdict: AggregateVerdict = isAuthentic(
    mode, verifiedAuthorityCount, verifiedEntryCount, totalEntryCount,
  )
    ? 'authentic'
    : 'unauthenticated'

  return {
    entries,
    verdict,
    verifiedAuthorityCount,
    totalEntryCount,
    verifiedEntryCount,
    mode,
  }
}

function isAuthentic(
  mode: VerificationMode,
  authorities: number,
  verifiedEntries: number,
  totalEntries: number,
): boolean {
  if (mode === 'strict') {
    return verifiedEntries === totalEntries && totalEntries > 0
  }
  return authorities >= 2
}

async function sha256Utf8(text: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

// SHA-256 of the JCS-canonical unsecured document (the body
// with its proof / signature removed). Shared by every
// entry, then combined with each entry's own proof-config
// hash to form that entry's hashData.
async function hashDocument(
  document: ProofCarrier | Record<string, unknown>,
): Promise<Uint8Array> {
  return sha256Utf8(
    canonicalize(unsecuredDocument(document as Record<string, unknown>)),
  )
}

// hashData for one entry: proofConfigHash || documentHash.
// The proof config is the entry minus proofValue, carrying
// the document's @context, exactly the bytes the signer
// hashed (see ./eddsa-jcs).
async function entryHashData(
  proof: ManifestSignature,
  documentHash: Uint8Array,
  context: unknown,
): Promise<Uint8Array> {
  const cfg = proofConfig(
    proof as unknown as Record<string, unknown>, context,
  )
  const proofConfigHash = await sha256Utf8(canonicalize(cfg))
  return joinHashes(proofConfigHash, documentHash)
}

// Verify a manifest's single platform signature. Unlike a
// snapshot (which carries a `proof` array of several
// aliases), the manifest carries one signature under the
// `signature` key, so the hashed body is the manifest minus
// that field. A 'verified' status means the version list
// itself (currentVersion, each version's url/hashValue,
// voidedAt, supersededBy) is authentic independently of any
// publisher database, which the per-snapshot proofs do not
// cover. Returns null when the manifest carries no
// signature at all. When pinnedPlatformKeys is supplied, the
// returned entry's `pinned` flag reports whether the
// manifest was signed under one of the pinned keys, so the
// caller can require it rather than trusting any key the
// manifest points at.
export async function verifyManifestSignature(
  manifest: Record<string, unknown>,
  pinnedPlatformKeys?: ReadonlyArray<string>,
): Promise<ProofEntryResult | null> {
  // The manifest carries `signature`; the EPCIS events
  // document carries `transpareo:signature` (namespaced to
  // pass EPCIS 2.0 schema validation). Same single-signature
  // scheme, so accept either key.
  const sig = (manifest['transpareo:signature']
    ?? manifest.signature) as ManifestSignature | undefined
  if (!sig) return null
  const documentHash = await hashDocument(manifest)
  const context = manifest['@context']
  return verifyEntry(sig, 0, documentHash, context, pinnedPlatformKeys)
}

// Hex form of hashDocument, exposed so the chain
// walker in actions.ts can recompute a prior
// snapshot's body hash and compare it against the
// manifest's hashValue claim (and the next snapshot's
// priorVersionHash claim) without depending on either.
export async function hexHashOfSnapshotBody(
  snapshot: ProofCarrier,
): Promise<string> {
  const digest = await hashDocument(snapshot)
  return hexOf(digest)
}

// The hash a snapshot contributes to the version chain,
// per its format. An ecdsa-sd snapshot is a Verifiable
// Credential whose manifest hashValue is the SHA-256 over
// ALL its RDFC canonical statements - equal to the
// issuer's mandatory-statements hash, because the public
// view reveals exactly the mandatory statements. A flat
// eddsa-jcs snapshot chains on its JCS body hash. The
// walker must pick per prior-version format: a chain can
// cross the cryptosuite boundary mid-history.
export async function hexChainHashOfSnapshot(
  snapshot: ProofCarrier,
): Promise<string> {
  const doc = snapshot as Record<string, unknown>
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

async function verifyEntry(
  proof: ManifestSignature,
  index: number,
  documentHash: Uint8Array,
  context: unknown,
  pinnedPlatformKeys: ReadonlyArray<string> | undefined,
  pinnedIssuerKeys?: ReadonlyArray<string>,
): Promise<ProofEntryResult> {
  const base = {
    index,
    verificationMethod: proof.verificationMethod,
    proofValue: proof.proofValue,
    pinned: false,
    issuerPinned: false,
  }

  let signature: Uint8Array
  try {
    signature = decodeMultibaseBase58(proof.proofValue)
  } catch (err) {
    return {
      ...base,
      status: 'invalid',
      reason: `bad signature encoding: ${describeError(err)}`,
    }
  }
  if (signature.length !== 64) {
    return {
      ...base,
      status: 'invalid',
      reason: `signature is ${signature.length} bytes, expected 64`,
    }
  }

  let resolved: ResolvedKey
  try {
    resolved = await resolveVerificationKey(proof.verificationMethod)
  } catch (err) {
    return {
      ...base,
      status: 'unreachable',
      reason: describeError(err),
    }
  }

  let hashData: Uint8Array
  try {
    hashData = await entryHashData(proof, documentHash, context)
  } catch (err) {
    return {
      ...base,
      status: 'invalid',
      reason: `hashing failed: ${describeError(err)}`,
    }
  }

  let ok: boolean
  try {
    ok = await resolved.verify(signature, hashData)
  } catch (err) {
    return {
      ...base,
      status: 'invalid',
      reason: `verify threw: ${describeError(err)}`,
    }
  }

  if (!ok) {
    return { ...base, status: 'invalid', reason: 'signature does not verify' }
  }
  // Pins are only meaningful when the signature actually
  // verified; otherwise an attacker could control the
  // URL the verifier fetches and trivially flag any
  // entry as "pinned".
  const pinned = (pinnedPlatformKeys ?? [])
    .includes(resolved.multibase)
  const issuerPinned = (pinnedIssuerKeys ?? [])
    .includes(resolved.multibase)
  return {
    ...base, status: 'verified', keyMultibase: resolved.multibase,
    pinned, issuerPinned,
  }
}

// Cache resolved keys by verificationMethod URL so two
// proof entries pointing at the same key (rare, but
// allowed) don't refetch + reimport. The map lives for the
// page's lifetime. This does not widen the trust model:
// with a platform key pinned, a swapped or poisoned
// resolution document yields a key that fails the pin check
// (its entry is never flagged `pinned`), so a cached entry
// cannot upgrade a verdict; with no key pinned the verifier
// already accepts whatever key each verificationMethod URL
// returns, so caching the first response changes nothing
// about what is trusted. Failed resolutions are evicted
// below so a transient error doesn't poison a later retry.
type Ed25519Verifier =
  (signature: Uint8Array, message: Uint8Array) => Promise<boolean>

interface ResolvedKey {
  readonly verify: Ed25519Verifier
  readonly multibase: string
}

const keyCache = new Map<string, Promise<ResolvedKey>>()

function resolveVerificationKey(method: string): Promise<ResolvedKey> {
  let pending = keyCache.get(method)
  if (pending) return pending
  pending = fetchAndImportKey(method)
  keyCache.set(method, pending)
  // If the fetch fails, evict so a retry can attempt
  // again. Without this a transient failure poisons the
  // cache for the lifetime of the page.
  pending.catch(() => keyCache.delete(method))
  return pending
}

async function fetchAndImportKey(method: string): Promise<ResolvedKey> {
  const { multibase, bytes } = await resolveMultikey(method)
  // Multikey for Ed25519: 0xed 0x01 prefix + 32-byte raw
  // key, then base58. Strip the two-byte prefix to get the
  // 32 raw public-key bytes.
  if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) {
    throw new Error('publicKeyMultibase is not an Ed25519 multikey')
  }
  const rawKey = bytes.slice(2)
  return { verify: await buildVerifier(rawKey), multibase }
}

// Build a verify function for a raw Ed25519 public key.
// Native WebCrypto when the engine has Ed25519; otherwise a
// vendored pure-JS verifier (noble-ed25519), lazily imported
// so engines with native support never download it. This is
// what lets the chip verify on browsers older than the
// native-Ed25519 floor (Chrome 137 / Firefox 129 / Safari
// 17) instead of silently failing.
async function buildVerifier(rawKey: Uint8Array): Promise<Ed25519Verifier> {
  if (await hasNativeEd25519()) {
    // Import as SPKI, not 'raw': Firefox rejects 'raw' for
    // Ed25519 public keys (accepts only 'spki'/'jwk'), and
    // 'raw' is not a spec-valid format for Ed25519 anyway.
    const key = await crypto.subtle.importKey(
      'spki', asBuffer(rawKeyToSpki(rawKey)), { name: 'Ed25519' },
      false, ['verify'],
    )
    return (sig, msg) => crypto.subtle.verify(
      { name: 'Ed25519' }, key, asBuffer(sig), asBuffer(msg),
    )
  }
  const ed = await import('./ed25519')
  // zip215: false picks the vendored library's strict
  // branch so edge-case signatures (small-order points,
  // non-canonical encodings) verify the same here as on
  // the WebCrypto path, which is strict RFC 8032.
  return (sig, msg) => ed.verifyAsync(sig, msg, rawKey, { zip215: false })
}

// Probe native WebCrypto Ed25519 once, with a known-good
// public key (RFC 8032 test vector) so the result reflects
// algorithm support, not the validity of any resolved key.
let nativeEd25519Probe: Promise<boolean> | null = null
function hasNativeEd25519(): Promise<boolean> {
  if (!nativeEd25519Probe) {
    nativeEd25519Probe = crypto.subtle.importKey(
      'spki', asBuffer(rawKeyToSpki(PROBE_PUBKEY)), { name: 'Ed25519' },
      false, ['verify'],
    ).then(() => true, () => false)
  }
  return nativeEd25519Probe
}

// Fixed 12-byte SubjectPublicKeyInfo DER header for an
// Ed25519 public key (AlgorithmIdentifier OID 1.3.101.112
// + BIT STRING tag), followed by the 32 raw key bytes.
const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
])
const PROBE_PUBKEY = hexToBytes(
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
)

function rawKeyToSpki(raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(ED25519_SPKI_PREFIX.length + raw.length)
  out.set(ED25519_SPKI_PREFIX, 0)
  out.set(raw, ED25519_SPKI_PREFIX.length)
  return out
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}
