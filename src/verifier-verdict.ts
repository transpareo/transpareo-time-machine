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
