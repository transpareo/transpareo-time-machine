/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * verificationMethod resolution shared by both proof
 * paths: the eddsa-jcs-2022 verifier (Ed25519 Multikeys)
 * and the ecdsa-sd-2023 verifier (P-256 Multikeys). The
 * curve-specific handling lives in each caller; the
 * fetch, the scheme-refusal safety check, the did:web
 * mapping, and the key selection are one implementation
 * here so they cannot drift apart.
 */

import { decodeMultibaseBase58 } from './multibase'

// A resolution document is either a single Multikey
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

export interface ResolvedMultikey {
  // The multibase z58 Multikey string, kept for pin
  // comparison; the bytes are its base58 decoding.
  readonly multibase: string
  readonly bytes: Uint8Array
}

// A key host that accepts a connection but never answers
// must not stall verification forever - matches the
// FETCH_TIMEOUT_MS budget host.ts gives every other fetch
// on the verify path.
const KEY_FETCH_TIMEOUT_MS = 15_000

// Fetch the verificationMethod's key document and return
// the selected Multikey (string + decoded bytes). The
// caller checks the multicodec prefix for its curve.
export async function resolveMultikey(
  method: string,
): Promise<ResolvedMultikey> {
  const { url, fragment } = splitVerificationMethod(method)

  // 'no-cache' revalidates the key document instead of
  // trusting a stale HTTP-cache copy; a rotated or fixed
  // key should take effect on the next page load.
  const res = await fetch(url, {
    credentials: 'omit', cache: 'no-cache',
    signal: AbortSignal.timeout(KEY_FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  const doc = await res.json() as ResolutionDoc
  const multibase = selectMultibase(doc, fragment)
  return { multibase, bytes: decodeMultibaseBase58(multibase) }
}

// Matches a URL scheme prefix (RFC 3986 alpha + alnum/+-.).
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

// Split a verificationMethod into a fetchable URL + an
// optional fragment. Only three shapes resolve: a did:web
// method (mapped to its did.json), an absolute https: URL,
// and a schemeless relative path (resolved by the platform
// fetch API against the embedding page's origin - the demo
// signer's snapshots and key documents are served from that
// same origin, so this is intentional there). Anything else
// carrying a scheme (http:, data:, blob:, file:, other did
// methods) is refused before any fetch happens, so a proof
// entry can't point key resolution at a plaintext host or a
// self-supplied inline document.
export function splitVerificationMethod(
  method: string,
): { url: string, fragment: string | undefined } {
  const hash = method.indexOf('#')
  const fragment = hash >= 0 ? method.slice(hash + 1) : undefined
  if (method.startsWith('did:web:')) {
    const base = hash >= 0 ? method.slice(0, hash) : method
    return { url: didWebToUrl(base), fragment }
  }
  const scheme = SCHEME_RE.exec(method)?.[0].toLowerCase()
  if (scheme && scheme !== 'https:') {
    throw new Error(`refusing to resolve a ${scheme} verificationMethod`)
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
    throw new Error('DID document has no matching verificationMethod')
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
