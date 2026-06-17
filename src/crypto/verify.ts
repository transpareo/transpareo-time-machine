/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * In-browser Ed25519 proof verification for the
 * multi-authority DPP snapshot proof set.
 *
 * Per-entry algorithm (eddsa-jcs-sha256, a deliberately
 * non-standard profile, NOT the W3C eddsa-jcs-2022 suite:
 * it signs a single SHA-256 of the JCS body and does not
 * bind a per-proof config hash, so off-the-shelf
 * eddsa-jcs-2022 verifiers will not interoperate):
 *   1. JCS-canonicalize the snapshot with the `proof`
 *      field removed.
 *   2. SHA-256 the canonical bytes -> 32-byte digest.
 *   3. Resolve `proof.verificationMethod` to a public key:
 *      a did:web method maps to its did.json and the key
 *      is selected from the verificationMethod array by
 *      fragment; an http(s) or relative URL is fetched and
 *      its publicKeyMultibase read directly.
 *   4. Decode `proof.proofValue` (multibase z-base-58
 *      "z" prefix + 64-byte raw signature) to bytes.
 *   5. crypto.subtle.verify(Ed25519, pubKey, sig, hash).
 *
 * The proof set has five entries today: three issuer
 * aliases (HTTPS host, did:web, HTTPS CDN fallback) and
 * two platform aliases (HTTPS host, did:web), with the
 * three issuer entries sharing one Ed25519 signature
 * and the two platform entries sharing another. The
 * CDN fallback exists so the issuer side stays
 * verifiable after the issuer's own hosts terminate.
 *
 * Aggregate rules:
 *   - Default (any-issuer-and-any-Transpareo): a
 *     snapshot is authentic when at least one entry
 *     verifies under each authority's signature group.
 *     Entries that fail to resolve (offline did host,
 *     dead CDN) are tolerated as long as one alias per
 *     authority makes it.
 *   - Strict (all-N): every entry must verify. Opt-in
 *     via { mode: 'strict' } for verifier surfaces
 *     that want to surface the full reachability
 *     picture rather than the two-of-two summary.
 *
 * The renderer groups by proofValue rather than reading
 * URL patterns, so the math survives renaming of
 * resolution hosts.
 */

import { canonicalize } from './jcs'
import { decodeMultibaseBase58 } from './multibase'
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
  // The shared signature value, kept on the result so
  // the UI can group entries by authority without
  // re-reading the source proof set.
  readonly proofValue: string
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
  // Number of distinct authority signature groups that
  // have at least one verified entry. The default rule
  // is authentic <=> this is >= 2 (any issuer entry +
  // any Transpareo entry); strict mode tightens it to
  // require every entry to verify.
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
  const entries = await Promise.all(
    proofs.map((p, i) =>
      verifyEntry(
        p, i, documentHash,
        opts.pinnedPlatformKeys, opts.pinnedIssuerKeys,
      ),
    ),
  )

  // Group verified entries by signature value; each
  // distinct group is one authority. Entries that share
  // a proofValue cover the same authority and one
  // verified entry is enough for that authority's
  // contribution to the aggregate.
  const verifiedSigs = new Set<string>()
  let verifiedEntryCount = 0
  for (const e of entries) {
    if (e.status === 'verified') {
      verifiedSigs.add(e.proofValue)
      verifiedEntryCount++
    }
  }

  const verifiedAuthorityCount = verifiedSigs.size
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

async function hashDocument(
  snapshot: ProofCarrier,
): Promise<Uint8Array> {
  // Spread strips the proof field from the body; the
  // remaining fields are JCS-canonicalized to the same
  // bytes the signer hashed when producing the
  // signatures.
  const { proof: _proof, ...rest } = snapshot as Record<string, unknown>
  const canonical = canonicalize(rest)
  const bytes = new TextEncoder().encode(canonical)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return new Uint8Array(digest)
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
  const sig = manifest.signature as ManifestSignature | undefined
  if (!sig) return null
  const { signature: _sig, ...body } = manifest
  const documentHash = await hashDocument(body)
  return verifyEntry(sig, 0, documentHash, pinnedPlatformKeys)
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
  let out = ''
  for (const b of digest) out += b.toString(16).padStart(2, '0')
  return out
}

async function verifyEntry(
  proof: ManifestSignature,
  index: number,
  documentHash: Uint8Array,
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

  let ok: boolean
  try {
    ok = await resolved.verify(signature, documentHash)
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
  return { ...base, status: 'verified', pinned, issuerPinned }
}

// A key resolution document is either a single Multikey
// (publicKeyMultibase at the top) or a DID document whose
// verificationMethod array is selected by fragment.
interface MultikeyEntry {
  readonly id?: string
  readonly publicKeyMultibase?: string
}
interface ResolutionDoc {
  readonly publicKeyMultibase?: string
  readonly verificationMethod?: ReadonlyArray<MultikeyEntry>
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
  const { url, fragment } = splitVerificationMethod(method)

  // 'no-cache' revalidates the key document instead of
  // trusting a stale HTTP-cache copy; a rotated or fixed
  // key should take effect on the next page load.
  const res = await fetch(url, {
    credentials: 'omit',
    cache: 'no-cache',
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`)
  }
  const doc = await res.json() as ResolutionDoc
  const multibase = selectMultibase(doc, fragment)
  const multikeyBytes = decodeMultibaseBase58(multibase)
  // Multikey for Ed25519: 0xed 0x01 prefix + 32-byte raw
  // key, then base58. Strip the two-byte prefix to get the
  // 32 raw public-key bytes.
  if (multikeyBytes.length !== 34 || multikeyBytes[0] !== 0xed
    || multikeyBytes[1] !== 0x01) {
    throw new Error('publicKeyMultibase is not an Ed25519 multikey')
  }
  const rawKey = multikeyBytes.slice(2)
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

// Matches a URL scheme prefix (RFC 3986 alpha + alnum/+-.).
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

// Split a verificationMethod into a fetchable URL + an
// optional fragment. Only three shapes resolve: a did:web
// method (mapped to its did.json), an absolute https: URL,
// and a schemeless relative path (which can only land on
// the page's own origin). Anything else carrying a scheme
// (http:, data:, blob:, file:, other did methods) is
// refused before any fetch happens, so a proof entry can't
// point key resolution at a plaintext host or a
// self-supplied inline document.
function splitVerificationMethod(
  method: string,
): { url: string; fragment: string | undefined } {
  const hash = method.indexOf('#')
  const fragment = hash >= 0 ? method.slice(hash + 1) : undefined
  if (method.startsWith('did:web:')) {
    const base = hash >= 0 ? method.slice(0, hash) : method
    return { url: didWebToUrl(base), fragment }
  }
  const scheme = SCHEME_RE.exec(method)?.[0].toLowerCase()
  if (scheme && scheme !== 'https:') {
    throw new Error(
      `refusing to resolve a ${scheme} verificationMethod`,
    )
  }
  // The fragment is not sent over the wire, so keeping it
  // in the URL is harmless and leaves it unchanged.
  return { url: method, fragment }
}

// did:web:example.com     -> https://example.com/.well-known/did.json
// did:web:example.com:a:b -> https://example.com/a/b/did.json
// Path segments are percent-encoded in the method, so
// each is decoded before it is joined into the URL.
function didWebToUrl(did: string): string {
  const parts = did.slice('did:web:'.length).split(':')
    .map((p) => decodeURIComponent(p))
  const host = parts[0]
  if (parts.length <= 1) return `https://${host}/.well-known/did.json`
  return `https://${host}/${parts.slice(1).join('/')}/did.json`
}

// Pick the public key from a resolution document. A DID
// document's verificationMethod array is selected by
// fragment (or the first entry when none is given); a
// single-key document exposes publicKeyMultibase at the
// top and the fragment is decorative.
function selectMultibase(
  doc: ResolutionDoc, fragment: string | undefined,
): string {
  if (Array.isArray(doc.verificationMethod)) {
    const entry = fragment
      ? doc.verificationMethod.find((m) => fragmentMatches(m.id, fragment))
      : doc.verificationMethod[0]
    const mb = entry?.publicKeyMultibase
    if (mb && mb.startsWith('z')) return mb
    throw new Error('DID document has no matching Ed25519 verificationMethod')
  }
  if (doc.publicKeyMultibase && doc.publicKeyMultibase.startsWith('z')) {
    return doc.publicKeyMultibase
  }
  throw new Error('resolution doc missing publicKeyMultibase')
}

function fragmentMatches(
  id: string | undefined, fragment: string,
): boolean {
  if (!id) return false
  return id === `#${fragment}` || id.endsWith(`#${fragment}`)
}

// Workaround for TS's recent narrowing of BufferSource:
// `Uint8Array<ArrayBufferLike>` is not assignable where
// `ArrayBuffer` is required because ArrayBufferLike now
// includes SharedArrayBuffer. The runtime values here
// are always plain ArrayBuffer-backed, so a tight slice
// of the underlying buffer is safe and matches the
// API's runtime contract.
function asBuffer(u: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u.byteLength)
  new Uint8Array(out).set(u)
  return out
}
