/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure verdict policy, shared by both verification
 * surfaces. aggregateVerdict/combinedVerdict are the
 * standalone <dpp-verifier> widget's verdict (a SECOND,
 * independent implementation next to the on-page chip's
 * actions.ts gates, kept as pure functions so it is
 * unit-testable without the DOM and cannot silently drift
 * unnoticed). artefactSignatureAcceptable is THE single
 * acceptance rule for a platform signature over a whole
 * artefact; actions.ts delegates to it so the chip and
 * the widget can never disagree on that policy.
 *
 * The widget verifies foreign DPPs too, so a configured
 * pin never gates pass/fail; it elevates the identity
 * tier (verdictIdentity below): 'pinned' for the host's
 * own platform, 'bound' when the signing keys resolve
 * from the domain the manifest's platform.did declares,
 * 'unconfirmed' otherwise. The badge may carry the
 * manifest's platform name only on the first two tiers.
 *
 * attributeAuthorities is the matching attribution rule:
 * which party each group of proof entries belongs to. Both
 * surfaces label their proof rows with it, so the modal's
 * per-version columns and the widget's authority cards can
 * never disagree about who signed what.
 */

import type { ProofEntryResult, VerificationResult } from '@/crypto/verify'
import type { ChainCheckResult } from '@/verifier-chain'

// A platform signature over a whole artefact (manifest
// version list, events sidecar), as the verdict gates
// consume it: the verify result, 'absent' when the artefact
// is present but unsigned, or null when there is no
// artefact to gate at all (single-snapshot boot, no events
// sidecar).
export type ArtefactSignatureState = ProofEntryResult | 'absent' | null

// Acceptance rule for such a signature. A missing artefact
// (null) is out of scope. Without pinned platform keys, a
// missing signature (older feeds) and an unreachable key
// host (tolerate flakiness) are acceptable; a
// present-but-invalid signature fails closed. A pinned
// build opted in to strictness: only a signature verified
// under one of the pinned keys passes, so a CDN that
// strips the signature or blocks the key host cannot
// silently downgrade the verdict. An empty pin set counts
// as unpinned.
export function artefactSignatureAcceptable(
  entry: ArtefactSignatureState,
  pinnedPlatformKeys: ReadonlyArray<string> | null | undefined,
): boolean {
  if (entry === null) return true
  if (pinnedPlatformKeys != null && pinnedPlatformKeys.length > 0) {
    return entry !== 'absent'
      && entry.status === 'verified'
      && entry.pinned
  }
  if (entry === 'absent') return true
  if (entry.status === 'unreachable') return true
  return entry.status === 'verified'
}

// `reason` is a stable code the UI maps to a localized
// string (kept out of this module so the verdict logic
// stays i18n-free and unit-testable).
export type VerdictReason =
  | 'authentic'
  | 'partial'
  | 'manifestSignature'
  | 'chainBroken'

export interface AggregateVerdict {
  readonly outcome: 'authentic' | 'unauthenticated'
  readonly reason: VerdictReason
  readonly verifiedEntryCount: number
  readonly totalEntryCount: number
}

// Pass/fail is judged on the DPP's own terms (the widget
// verifies foreign DPPs too, so a configured pin must not
// fail a passport that simply belongs to another
// platform). The pin's effect lives in verdictIdentity
// below: it elevates the identity tier instead of gating.
export function aggregateVerdict(
  result: VerificationResult,
): AggregateVerdict {
  const counts = {
    verifiedEntryCount: result.verifiedEntryCount,
    totalEntryCount: result.totalEntryCount,
  }
  if (result.verdict === 'authentic') {
    return { outcome: 'authentic', reason: 'authentic', ...counts }
  }
  return { outcome: 'unauthenticated', reason: 'partial', ...counts }
}

// Full widget verdict: the snapshot-proof verdict above,
// gated by the manifest's own signature and the
// version-history chain walk, mirroring the SPA's
// ensureVersionLoaded conjunction. A snapshot-proof
// failure wins the headline (it names the most specific
// problem); then the manifest gate, then the chain. The
// manifest gate uses the unpinned tolerance (a foreign
// DPP's manifest is never pin-signed); a stripped
// signature costs the identity tier instead.
export function combinedVerdict(
  result: VerificationResult,
  manifestSignature: ArtefactSignatureState,
  chain: ChainCheckResult,
): AggregateVerdict {
  const base = aggregateVerdict(result)
  if (base.outcome === 'unauthenticated') return base
  if (!artefactSignatureAcceptable(manifestSignature, null)) {
    return { ...base, outcome: 'unauthenticated', reason: 'manifestSignature' }
  }
  if (chain.status === 'broken') {
    return { ...base, outcome: 'unauthenticated', reason: 'chainBroken' }
  }
  return base
}

// ─── Identity tier ───────────────────────────────────
//
// Who an authentic verdict is FROM. The badge's name comes
// from manifest.platform.name, so the name must be earned,
// not just claimed:
//
//   'pinned'      - a verified proof entry matched the
//                   caller-pinned platform key AND the
//                   manifest signature verified under it.
//                   The strongest claim; pinning is the
//                   additional security layer a host page
//                   opts into for its own platform.
//   'bound'       - no pin (or a foreign DPP): a verified
//                   entry's key resolved from the same
//                   domain that manifest.platform.did
//                   declares (did:web). Forging this
//                   requires controlling that domain, so
//                   the declared name is credible.
//   'unconfirmed' - signatures verify but nothing ties
//                   them to the declared platform identity
//                   (no did:web, or keys on other hosts).
//                   The UI must not present a named
//                   "Verified by ..." claim here.
export type VerdictIdentity = 'pinned' | 'bound' | 'unconfirmed'

export function verdictIdentity(
  result: VerificationResult,
  pins: ReadonlyArray<string> | null | undefined,
  manifestSignature: ArtefactSignatureState,
  platformDid: string | undefined,
  manifestUrl: string,
): VerdictIdentity {
  const pinnedEntry = pins != null && pins.length > 0
    && result.entries.some(
      (e) => e.status === 'verified' && e.pinned,
    )
  if (pinnedEntry && artefactSignatureAcceptable(manifestSignature, pins)) {
    return 'pinned'
  }

  const domain = didWebDomain(platformDid)
  const bound = domain != null && result.entries.some(
    (e) => e.status === 'verified'
      && methodDomain(e.verificationMethod, manifestUrl) === domain,
  )
  return bound ? 'bound' : 'unconfirmed'
}

// ─── Authority attribution ───────────────────────────

export type AuthorityKind = 'issuer' | 'platform' | 'other'

// The DIDs a DPP declares for its two parties, as the
// manifest and every snapshot carry them.
export interface DeclaredAuthorities {
  readonly issuerDid?: string
  readonly platformDid?: string
}

// As much of a proof entry as attribution reads.
export interface AuthorityEntry {
  readonly verificationMethod: string

  // Set when the entry verified under one of the host page's
  // pinned platform keys (see crypto/verify).
  readonly pinned?: boolean
}

// Which party signed each group of proof entries, a group
// being the entries that resolved to one key. Answers for
// the whole set at once because the last rule is structural:
// a DPP is signed by two parties, so the group opposite an
// identified one is the remaining party.
export function attributeAuthorities(
  groups: ReadonlyArray<ReadonlyArray<AuthorityEntry>>,
  declared: DeclaredAuthorities,
): AuthorityKind[] {
  return completeTwoParty(groups.map((g) => authorityKind(g, declared)))
}

// A DPP carries the issuer's proof and the platform's
// counter-signature, so two groups with exactly one of them
// identified leave no doubt about the other. Three or more
// groups, or none identified, stay as they are: a guess
// there would put a party's name on a key nothing vouches
// for.
function completeTwoParty(kinds: AuthorityKind[]): AuthorityKind[] {
  if (kinds.length !== 2) return kinds
  const [first, second] = kinds
  if (first === 'other' && second !== 'other') {
    return [otherParty(second), second]
  }
  if (second === 'other' && first !== 'other') {
    return [first, otherParty(first)]
  }
  return kinds
}

function otherParty(kind: Exclude<AuthorityKind, 'other'>): AuthorityKind {
  return kind === 'issuer' ? 'platform' : 'issuer'
}

// Which party a single group belongs to, in descending order
// of how directly the evidence names a role. A pin is the
// host page's own statement that the key is its platform's.
// A key path names the role outright, which is how an
// eddsa-jcs proof set writes its aliases. A did:web method,
// how an ecdsa-sd credential names each authority, matches
// only the DIDs this DPP declares - an issuer whose signing
// key lives under a DID the passport never names falls
// through to the structural rule above.
function authorityKind(
  entries: ReadonlyArray<AuthorityEntry>,
  declared: DeclaredAuthorities,
): AuthorityKind {
  if (entries.some((e) => e.pinned)) return 'platform'

  for (const e of entries) {
    if (/\/keys\/issuer\b/.test(e.verificationMethod)) return 'issuer'
    if (/\/keys\/platform\b/.test(e.verificationMethod)) return 'platform'
  }

  const { issuerDid, platformDid } = declared
  for (const e of entries) {
    const did = didOfMethod(e.verificationMethod)
    if (did == null) continue
    if (issuerDid != null && did === issuerDid) return 'issuer'
    if (platformDid != null && did === platformDid) return 'platform'
  }
  return 'other'
}

// did:web:example.com#key-2 -> did:web:example.com. Null for
// an http(s) method, which the key-path patterns above are
// the rule for.
function didOfMethod(method: string): string | null {
  if (!method.startsWith('did:')) return null
  const hash = method.indexOf('#')
  return hash >= 0 ? method.slice(0, hash) : method
}

// did:web:example.com           -> example.com
// did:web:example.com:dpp:keys  -> example.com
function didWebDomain(did: string | undefined): string | null {
  if (!did?.startsWith('did:web:')) return null
  const host = did.slice('did:web:'.length).split(':')[0]
  if (!host) return null
  try {
    return decodeURIComponent(host).toLowerCase()
  } catch {
    return null
  }
}

// The domain a proof entry's key actually resolved from:
// the did:web host, or the (manifest-relative) URL's
// hostname.
function methodDomain(method: string, base: string): string | null {
  if (method.startsWith('did:web:')) {
    return didWebDomain(method.split('#')[0])
  }
  try {
    return new URL(method, base).hostname.toLowerCase()
  } catch {
    return null
  }
}
