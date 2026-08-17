/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Mutations on the shared signal store. Components
 * call into these instead of writing signals directly,
 * so the intent ("navigate to event N", "dismiss the
 * banner") is named and grep-able.
 *
 * Pure derivations live in `state.ts`; gesture input
 * lives in `gestures.ts`; one-shot lifecycle lives in
 * `bootstrap.ts`.
 */
import {
  versionStates,
  focusedEventId, hoveredEventId,
  sortedEvents, focusIndex,
  timelineState,
  dragProgress, dragActive, isResidualNav,
  outStartDrag, lastNavDir,
  NAV_VISUAL_CAP, RELEASE_ANIM_MS,
} from '@/state'
import * as host from '@/host'
import type { SignedSnapshot, VersionState } from '@/archive'
import {
  verifyManifestSignature, hexChainHashOfSnapshot,
} from '@/crypto/verify'
import type { ProofEntryResult, VerificationResult } from '@/crypto/verify'
import { verifySnapshotAnySuite } from '@/crypto/dispatch'
import { manifestProofState, eventsProofState } from '@/state'
import { config } from '@/config'
import {
  artefactSignatureAcceptable, type ArtefactSignatureState,
} from '@/verifier-verdict'
import { revocationStatus, type RevocationStatus } from '@/revoked-roots'
import { effect } from '@/reactive/signals'
import { describeError } from '@/errors'

// Verify the manifest's single platform signature once and
// share the result across every version's verdict. The
// manifest signature authenticates the version list itself
// (currentVersion, each version's url/hashValue, voidedAt),
// which the per-snapshot proofs do not cover. The verdict is
// cached until a reboot (one manifest per boot) or a
// re-verify retry, which drops it so a transient key-host
// failure does not outlive the click meant to clear it.
let manifestVerifyPromise: Promise<ArtefactSignatureState> | null = null
function verifyManifest(): Promise<ArtefactSignatureState> {
  if (manifestVerifyPromise) return manifestVerifyPromise
  const m = host.manifest.peek()

  // 'absent' (manifest present but unsigned) is kept apart
  // from null (no manifest at all, the single-snapshot boot):
  // a pinned build must reject the former (a stripped
  // signature) while the latter has no version list to gate.
  manifestVerifyPromise = (
    m
      ? verifyManifestSignature(
          m as unknown as Record<string, unknown>,
          config.pinnedPlatformKeys,
        ).then((res) => res ?? ('absent' as const))
      : Promise.resolve(null)
  )
    .then((res) => {
      manifestProofState.set(res ?? 'absent')
      return res
    })
    .catch((err) => {
      // A throw here is a real failure (canonicalization or
      // hashing blew up), not a tolerable missing signature.
      // Fail closed: surface an invalid entry so the verdict
      // gate rejects the version instead of treating it as
      // unsigned.
      console.warn('[manifest] signature verify threw:', err)
      const errored: ProofEntryResult = {
        index: 0,
        verificationMethod: '',
        status: 'invalid',
        proofValue: '',
        pinned: false,
        issuerPinned: false,
        reason: `manifest signature verify threw: ${describeError(err)}`,
      }
      manifestProofState.set(errored)
      return errored
    })
  return manifestVerifyPromise
}

// Verify the events sidecar's document-level platform
// signature once and cache the verdict for the page's
// lifetime. The EPCIS file the timeline is built from
// carries a single `signature` block (same scheme as the
// manifest), so the same verifier checks it: JCS-canonical
// body minus `signature`, SHA-256, Ed25519 under the
// resolved platform key. A genuinely unsigned feed resolves
// to 'absent' (tolerated); a present-but-invalid signature
// is surfaced for the proof modal's events badge. Per-event
// proofs are a backend convenience for single-event pulls
// and are not re-checked here; they ride inside the signed
// document body, so the document signature already covers
// them. Idempotent: the first call kicks the verify off and
// later calls are no-ops.
let eventsVerifyPromise: Promise<ProofEntryResult | null> | null = null
export function ensureEventsVerified(): void {
  if (eventsVerifyPromise) return
  const doc = host.epcisDocument.peek()
  eventsVerifyPromise = (
    doc
      ? verifyManifestSignature(
          doc as unknown as Record<string, unknown>,
          config.pinnedPlatformKeys,
        )
      : Promise.resolve(null)
  )
    .then((res) => {
      eventsProofState.set(res ?? 'absent')
      return res
    })
    .catch((err) => {
      // A throw here is a real failure (canonicalisation or
      // hashing blew up), not a tolerable missing signature.
      // Fail closed: surface an invalid entry so the events
      // badge reads as a failure instead of "unsigned".
      console.warn('[events] signature verify threw:', err)
      const errored: ProofEntryResult = {
        index: 0,
        verificationMethod: '',
        status: 'invalid',
        proofValue: '',
        pinned: false,
        issuerPinned: false,
        reason: `events signature verify threw: ${describeError(err)}`,
      }
      eventsProofState.set(errored)
      return errored
    })
}

// Forget the per-boot verify latches and stop any
// in-flight release animation, so a reboot onto a new
// `src` re-verifies the new artefacts instead of reusing
// the previous DPP's cached verdicts. The revocation
// guard is pin-scoped, not boot-scoped, and stays armed.
export function resetVerifyCaches(): void {
  manifestVerifyPromise = null
  eventsVerifyPromise = null
  freshlyRead.clear()
  freshReads.clear()
  cancelReleaseAnim()
}

const REVOKED_REASON =
  'the platform key pinned by this build is revoked'
const REVOCATION_UNREACHABLE_REASON =
  'the revocation list for the pinned platform key is unreachable'

// On pinned builds both 'revoked' and 'unreachable' fail
// the verdict: the network attacker the pin defends against
// could otherwise keep a revoked key trusted by blocking
// the well-known revocation fetch. 'unreachable' only
// occurs with a pin configured (unpinned boots skip the
// check entirely and read 'unpinned').
function revocationGateBlocks(status: RevocationStatus): boolean {
  return status === 'revoked' || status === 'unreachable'
}

function revocationReason(status: RevocationStatus): string {
  return status === 'revoked'
    ? REVOKED_REASON
    : REVOCATION_UNREACHABLE_REASON
}

// Acceptance policy for a single platform signature bound to
// a whole artefact: the manifest version list (currentVersion,
// each version's url/hashValue, the chain anchor) or the
// events sidecar. The rule itself lives in verifier-verdict
// (artefactSignatureAcceptable, shared with the standalone
// widget so the two surfaces can't drift); this binds it to
// the SPA's pinned-key config.
export function signatureIsAcceptable(
  entry: ArtefactSignatureState,
): boolean {
  return artefactSignatureAcceptable(entry, config.pinnedPlatformKeys)
}

// The per-version pin gates, judged against the config's
// pin sets. Platform: when the host page pins platform
// keys, the verified entries must include one signed under
// a pinned key. Issuer: same rule for the issuer's declared
// keys (under BYOK, the customer's own registered keys).
// An absent or empty set leaves its gate open; that side
// falls back to the signature-grouping rule in verify.ts.
export function pinGatesOk(
  entries: ReadonlyArray<ProofEntryResult>,
): { pinOk: boolean; issuerPinOk: boolean } {
  const platformPins = config.pinnedPlatformKeys ?? []
  const issuerPins = config.pinnedIssuerKeys ?? []
  return {
    pinOk: platformPins.length === 0
      || entries.some((e) => e.pinned),
    issuerPinOk: issuerPins.length === 0
      || entries.some((e) => e.issuerPinned),
  }
}

// Force every already-stored 'verified' verdict to 'failed'
// the instant the revoked-roots check trips ('revoked' or,
// on pinned builds, 'unreachable').
// ensureVersionLoaded reads revocationStatus() once, when a
// snapshot verify resolves, so a version verified before the
// async revocation fetch settles would otherwise keep a
// stale green chip. This reactive guard closes that race;
// versions verified after the check settles are caught
// inline by the revocation gate. Armed once at boot from
// bootstrap-spa.
let revocationGuardArmed = false
export function armRevocationGuard(): void {
  if (revocationGuardArmed) return
  revocationGuardArmed = true
  effect(() => {
    const status = revocationStatus()
    if (!revocationGateBlocks(status)) return
    versionStates.update((states) => {
      let changed = false
      const next: Record<number, VersionState> = { ...states }
      for (const key of Object.keys(next)) {
        const n = Number(key)
        const s = next[n]
        if (s.status !== 'verified') continue
        next[n] = {
          status: 'failed',
          result: s.result,
          chain: s.chain,
          reason: revocationReason(status),
        }
        changed = true
      }
      return changed ? next : states
    })
  })
}

// ─── Lazy version verify ─────────────────────────────

// Verifies a snapshot's proof in the browser under whichever
// cryptosuite it declares (see crypto/dispatch): the
// eddsa-jcs-2022 multi-authority proof set, or the
// ecdsa-sd-2023 derived proofs. The aggregate 2-of-2 verdict
// drives the verification chip; the per-entry results power
// the proof modal's chain rendering. Async so the chip flips
// through "Verifying" to its outcome without blocking the
// first paint.
//
// Snapshots not yet in the host cache get fetched
// lazily via host.fetchSnapshot. The host module
// resolves each version's URL relative to the manifest
// the element was booted from.
//
// A publisher may republish a version URL - the demo
// publisher is rebuilt hourly under a new signing key -
// which leaves a returning visitor's HTTP cache holding the previous
// publish. Those bytes render but no longer match the
// revalidated manifest, so a verdict that rejects them is
// re-taken on bytes refetched past the cache: a failed chip
// always describes what the origin serves now.
export function ensureVersionLoaded(n: number): void {
  if (versionStates.peek()[n]) return
  versionStates.update((m) => ({ ...m, [n]: { status: 'pending' } }))

  // A reboot onto a new `src` clears versionStates; a
  // verify that was still in flight for the previous DPP
  // must not write its verdict into the fresh map (version
  // numbers collide across DPPs).
  const epoch = host.currentBootEpoch()

  judgeVersion(n, false)
    .then((verdict) => (
      verdict.bytesRejected && refetchable() ? judgeVersion(n, true) : verdict
    ))
    .then((verdict) => {
      if (epoch !== host.currentBootEpoch()) return
      versionStates.update((m) => ({ ...m, [n]: verdict.state }))
    })
    .catch((err: unknown) => {
      if (epoch !== host.currentBootEpoch()) return
      console.warn(`Version ${n} verify threw:`, err)
      versionStates.update((m) => ({
        ...m,
        [n]: {
          status: 'failed',
          result: {
            entries: [],
            verdict: 'unauthenticated',
            verifiedAuthorityCount: 0,
            totalEntryCount: 0,
            verifiedEntryCount: 0,
            mode: 'default',
          },
          chain: { status: 'unknown' },
          reason: String(err),
        },
      }))
    })
}

// One version's verdict, plus whether the failure is one
// that other bytes could fix. The artefact gates (the
// manifest's hash claim for this version, the snapshot
// proof, the chain link) all judge snapshot bytes, so
// re-reading those can overturn the verdict; the revocation,
// pin and manifest-signature gates judge the build's policy
// and the version list, neither of which a snapshot refetch
// touches.
interface VersionVerdict {
  readonly state: VersionState
  readonly bytesRejected: boolean
}

// Judge one version end to end. `fresh` re-reads the snapshot
// (and, through the chain walk, its priors) past the HTTP
// cache first, so the verdict describes what the origin
// serves rather than a publish the browser kept.
async function judgeVersion(
  n: number, fresh: boolean,
): Promise<VersionVerdict> {
  // Verify the raw signed bytes, not the adapted render
  // model: the proof and the priorVersionHash chain hash
  // the snapshot exactly as it was published.
  const raw = await readRawSnapshot(n, fresh)
  if (!raw) throw new Error(`No snapshot available for version ${n}`)

  const bodyOk = await bodyMatchesManifest(n, raw)
  const result = await verifySnapshotAnySuite(
    raw as unknown as Record<string, unknown>, {
      pinnedPlatformKeys: config.pinnedPlatformKeys,
      pinnedIssuerKeys: config.pinnedIssuerKeys,
    },
  )
  const chain = await verifyChainLink(n, raw, fresh)
  const manifestEntry = await verifyManifest()

  const proofOk = result.verdict === 'authentic'
  const chainOk = chain.status !== 'broken'

  // When the host page pins platform and/or issuer keys, the
  // chip requires a verified entry under each pinned set.
  // Without pins (forks, offline kiosks), fall back to the
  // signature-grouping rule from verify.ts.
  const { pinOk, issuerPinOk } = pinGatesOk(result.entries)

  // Manifest version-list signature gate (see
  // signatureIsAcceptable): unpinned builds tolerate a
  // missing signature or an unreachable key host and fail
  // closed on a present-but-invalid one; a build that pins
  // a platform key requires the manifest to have verified
  // under that pinned key.
  const manifestOk = signatureIsAcceptable(manifestEntry)

  // Pinned root revoked, or its revocation list unreachable?
  // The well-known fetch in revoked-roots.ts sets this flag
  // at boot; once tripped, every snapshot is forced
  // unauthenticated regardless of its proof.
  const revocation = revocationStatus()
  const revocationOk = !revocationGateBlocks(revocation)

  const ok = proofOk && chainOk && pinOk && issuerPinOk
    && revocationOk && manifestOk && bodyOk
  if (ok) {
    return {
      state: { status: 'verified', result, chain },
      bytesRejected: false,
    }
  }
  const reason = failureReason({
    version: n, revocation, manifestOk, manifestEntry, bodyOk,
    pinOk, issuerPinOk, chain, result,
  })

  // Zero judged entries means the dispatcher had nothing to
  // check (no proof, or an unshipped cryptosuite): mark the
  // state unverifiable so the UI shows a question mark
  // rather than a failure.
  const state: VersionState = result.totalEntryCount === 0
    ? { status: 'failed', result, chain, reason, unverifiable: true }
    : { status: 'failed', result, chain, reason }
  return {
    state,
    bytesRejected: !bodyOk || !proofOk || !chainOk,
  }
}

// Versions whose host cache holds bytes read from the origin
// past the browser's HTTP cache. One honest read per version
// serves every walk of a judging pass: after it the cache
// holds what the origin serves, so a later fresh walk over
// the same version would re-download for nothing. A version
// is marked only once its read lands (a read that fails
// leaves it eligible for another) and unmarked again by
// retryFailedVersions when a failed verdict is retried.
const freshlyRead = new Set<number>()

// Fresh reads in flight, shared between concurrent walkers:
// a version judging itself while another version's chain
// walk is re-reading it must wait for the origin's bytes
// rather than judge the copy that read is about to replace.
const freshReads =
  new Map<number, Promise<SignedSnapshot | undefined>>()

// The proof modal's re-verify. A failed verdict may be
// transient (key host briefly unreachable) or describe bytes
// the origin has since replaced, so the retry forgets what
// the failed pass concluded from - the fresh-read marks, the
// memoized manifest signature verdict and the failed states
// themselves - and judges every version again.
export function retryFailedVersions(): void {
  freshlyRead.clear()
  manifestVerifyPromise = null
  versionStates.update((states) => {
    let changed = false
    const next: Record<number, VersionState> = { ...states }
    for (const key of Object.keys(next)) {
      const n = Number(key)
      if (next[n].status !== 'failed') continue
      delete next[n]
      changed = true
    }
    return changed ? next : states
  })
  const m = host.manifest.peek()
  if (!m) return
  for (const v of m.versions) ensureVersionLoaded(v.number)
}

// One version's raw bytes, from the host cache or the CDN.
// `fresh` reads past the browser's HTTP cache even when a
// copy is already cached, which is how a version stored at
// boot gets a second, honest reading.
async function readRawSnapshot(
  n: number, fresh: boolean,
): Promise<SignedSnapshot | undefined> {
  if (fresh && !freshlyRead.has(n)) return freshRawSnapshot(n)
  if (!host.rawSnapshots.peek()[n]) await host.fetchSnapshot(n)
  return host.rawSnapshots.peek()[n]
}

// The origin read behind readRawSnapshot's fresh path.
function freshRawSnapshot(
  n: number,
): Promise<SignedSnapshot | undefined> {
  const inFlight = freshReads.get(n)
  if (inFlight) return inFlight
  const read = host.fetchSnapshot(n, { reload: true })
    .then((snapshot) => {
      // A null snapshot is a reboot that landed mid-flight;
      // its bytes were discarded, so the version has not had
      // its honest read yet.
      if (snapshot) freshlyRead.add(n)
      return host.rawSnapshots.peek()[n]
    })
    .finally(() => freshReads.delete(n))
  freshReads.set(n, read)
  return read
}

// Do these bytes still hash to what the manifest claims for
// this version? The manifest is revalidated on every boot, so
// its hashValue is the current claim about the version; bytes
// that miss it are a different publish of the same URL (or
// were tampered with) and must not paint under a green chip.
// A version the manifest makes no claim about - the
// single-snapshot boot, an entry without a hash - has nothing
// to check against.
async function bodyMatchesManifest(
  n: number, raw: SignedSnapshot,
): Promise<boolean> {
  const entry = host.manifest.peek()?.versions.find((v) => v.number === n)
  if (!entry?.hashValue) return true
  const computed = await hexChainHashOfSnapshot(raw)
  return computed === entry.hashValue
}

// Only manifest mode can re-read a version: a lone snapshot
// has no version list to resolve a URL from, and its boot
// fetch already revalidated it.
function refetchable(): boolean {
  return host.manifest.peek() !== null
}

// First failing gate, in priority order, as a human-readable
// reason for the proof modal. The order mirrors the
// conjunction in judgeVersion, so the message names the
// strongest failure when several gates fail at once.
function failureReason(gates: {
  version: number
  revocation: RevocationStatus
  manifestOk: boolean
  manifestEntry: ArtefactSignatureState
  bodyOk: boolean
  pinOk: boolean
  issuerPinOk: boolean
  chain: ChainStatusResult
  result: VerificationResult
}): string {
  const {
    version, revocation, manifestOk, manifestEntry, bodyOk,
    pinOk, issuerPinOk, chain, result,
  } = gates
  if (revocationGateBlocks(revocation)) {
    return revocationReason(revocation)
  }
  if (!manifestOk) {
    return `${manifestGateReason(manifestEntry)}; `
      + 'the version list is unauthenticated'
  }
  if (!bodyOk) {
    return `v${version} body does not hash to the manifest claim`
  }
  if (chain.status === 'broken') {
    return chain.reason ?? 'priorVersionHash does not match manifest'
  }
  if (!pinOk) {
    return 'no pinned platform key is among the verified entries'
  }
  if (!issuerPinOk) {
    return 'no declared issuer key is among the verified entries'
  }
  if (result.entries.length === 0) {
    return 'snapshot carries no proof entries'
  }
  if (result.mode === 'strict') {
    return `${result.verifiedEntryCount} of `
      + `${result.totalEntryCount} entries verified`
  }
  return `${result.verifiedAuthorityCount} of 2 authorities verified`
}

// Names what the manifest gate actually rejected. The
// absent/unreachable wordings only occur on pinned builds;
// an unpinned build tolerates both states.
function manifestGateReason(entry: ArtefactSignatureState): string {
  if (entry === 'absent') {
    return 'manifest is unsigned but this build pins a platform key'
  }
  if (entry !== null && entry.status === 'unreachable') {
    return 'manifest signature key is unreachable '
      + 'but this build pins a platform key'
  }
  if (entry !== null && entry.status === 'verified') {
    return 'manifest is signed by a key other than '
      + 'the pinned platform key'
  }
  return 'manifest signature does not verify'
}

// ─── priorVersionHash chain link check ───────────────

// Walks the snapshot chain backwards from `versionNumber`
// down to v1. For each step we recompute the prior
// snapshot's chain hash from its bytes - per that prior's
// own format (JCS body hash for a flat eddsa-jcs snapshot,
// SHA-256 over the RDFC canonical statements for an
// ecdsa-sd credential; a chain can cross the cryptosuite
// boundary mid-history) - and cross-check it against TWO
// independent claims:
//
//   - the manifest's `versions[N-1].hashValue` entry, and
//   - the next snapshot's `priorVersionHash` field.
//
// A claim-vs-claim comparison alone (which is what the
// renderer did originally) doesn't catch the case where
// both the manifest and the new snapshot have been
// re-emitted with matching forged hashes; recomputing
// from bytes does, because the prior snapshot's content
// is what gets signed. v1 has no priorVersionHash so the
// recursion bottoms out at 'not-applicable'.
//
// The walker fetches missing prior snapshots through the
// same host cache as ensureVersionLoaded; subsequent
// scrubs hit the cache instead of refetching. `fresh`
// re-reads every prior past the browser's HTTP cache, which
// is what the verdict layer's retry pass sets. If the
// manifest itself is unavailable (no entry to compare
// against) the link is reported as 'unknown' so the
// chip can render a "verification pending" state rather
// than a false 'broken'.
// Read a raw snapshot's priorVersionHash field. An ecdsa-sd
// snapshot is a Verifiable Credential, so the field lives
// under credentialSubject; a flat eddsa-jcs snapshot carries
// it at the top level.
function priorHashOf(snap: SignedSnapshot): string | undefined {
  const r = snap as Record<string, unknown>
  const subject = r.credentialSubject
  const scope = (subject && typeof subject === 'object')
    ? subject as Record<string, unknown> : r
  const v = scope.priorVersionHash
  return typeof v === 'string' ? v : undefined
}

export async function verifyChainLink(
  versionNumber: number,
  snapshot: SignedSnapshot,
  fresh = false,
): Promise<ChainStatusResult> {
  if (versionNumber === 1) return { status: 'not-applicable' }

  const priorVersionHash = priorHashOf(snapshot)
  const m = host.manifest.peek()
  if (!m) return { status: 'unknown' }

  const priorEntry = m.versions.find(
    (v) => v.number === versionNumber - 1,
  )
  if (!priorEntry) {
    return {
      status: 'broken',
      reason: `manifest has no entry for v${versionNumber - 1}`,
    }
  }
  if (!priorVersionHash) {
    return {
      status: 'broken',
      reason: 'snapshot has no priorVersionHash field',
    }
  }
  if (priorVersionHash !== priorEntry.hashValue) {
    return {
      status: 'broken',
      reason: 'priorVersionHash does not match the manifest',
    }
  }

  // Recompute the prior body's hash and compare to both
  // claims. fetchSnapshot populates both caches; read the
  // raw bytes here so the hash matches the signed body. On a
  // fresh walk the prior is re-read past the HTTP cache too:
  // a link breaks on a republished prior just as readily as
  // on a republished head.
  const priorVersion = versionNumber - 1
  const prior = await readRawSnapshot(priorVersion, fresh)
  if (!prior) {
    return {
      status: 'unknown',
      reason: `prior snapshot v${priorVersion} not retrievable`,
    }
  }
  const computed = await hexChainHashOfSnapshot(prior)
  if (computed !== priorEntry.hashValue) {
    return {
      status: 'broken',
      reason: `v${priorVersion} body does not hash to the manifest claim`,
    }
  }
  if (computed !== priorVersionHash) {
    return {
      status: 'broken',
      reason: `v${priorVersion} body does not hash to v${versionNumber}'s `
        + 'priorVersionHash claim',
    }
  }

  // Recurse so the entire chain is validated, not just
  // this one step. Each prior link's status surfaces
  // through its own ensureVersionLoaded call when the
  // visitor scrubs; the inline recursion here is what
  // satisfies the audit's "walk backwards" contract
  // even when the user only ever views the head.
  // 'unknown' propagates too: a chain whose tail could
  // not be checked (prior snapshot unretrievable) must
  // not surface as a green "fully walked" tick.
  if (priorVersion === 1) return { status: 'ok' }
  const deeper = await verifyChainLink(priorVersion, prior, fresh)
  if (deeper.status === 'ok' || deeper.status === 'not-applicable') {
    return { status: 'ok' }
  }
  return deeper
}

export type ChainStatus = 'ok' | 'broken' | 'not-applicable' | 'unknown'

export interface ChainStatusResult {
  readonly status: ChainStatus
  readonly reason?: string
}

// ─── Drag animation primitive ────────────────────────

let releaseRaf: number | null = null

export function cancelReleaseAnim(): void {
  if (releaseRaf != null) {
    cancelAnimationFrame(releaseRaf)
    releaseRaf = null
  }
}

// Tween dragProgress to a target over duration. Used by
// click-jump (navByEventId) and gesture-release
// (gestures.ts -> commitNavByDelta). Cubic ease-out.
export function animateDragTo(target: number, durationMs: number): void {
  cancelReleaseAnim()
  const start = dragProgress.peek()
  if (Math.abs(start - target) < 0.0005) {
    dragProgress.set(target)
    releaseRaf = requestAnimationFrame(() => {
      releaseRaf = null
      dragActive.set(false)
      isResidualNav.set(false)
    })
    return
  }
  const startTime = performance.now()
  const step = (now: number): void => {
    const tt = Math.min(1, (now - startTime) / durationMs)
    const eased = 1 - Math.pow(1 - tt, 3)
    dragProgress.set(start + (target - start) * eased)
    if (tt < 1) {
      releaseRaf = requestAnimationFrame(step)
    } else {
      releaseRaf = null
      dragProgress.set(target)
      dragActive.set(false)
      isResidualNav.set(false)
    }
  }
  releaseRaf = requestAnimationFrame(step)
}

// ─── Navigation ──────────────────────────────────────

// Animated jump to a target event index. dragProgress
// kicks to -visualShift then eases to 0, the deck
// "shuffles" the slot delta even on a far click.
export function navByEventId(id: string | null): void {
  hoveredEventId.set(null)

  const list = sortedEvents()
  let targetIdx: number
  if (!id) {
    targetIdx = list.length - 1
  } else {
    targetIdx = list.findIndex((e) => e.id === id)
    if (targetIdx < 0) return
  }

  const currentIdx = focusIndex()
  if (targetIdx === currentIdx) {
    // No slot change (re-selecting the current version, a
    // boundary prev/next, or back/forward onto the focused
    // event). Sync focus, then ease any in-flight release
    // tween home rather than cancelling it: a bare cancel
    // freezes the live card at a partial blur/opacity.
    focusedEventId.set(id)
    if (dragActive.peek() || dragProgress.peek() !== 0) {
      animateDragTo(0, RELEASE_ANIM_MS)
    }
    return
  }

  cancelReleaseAnim()
  const steps = targetIdx - currentIdx
  const dirSign = steps > 0 ? 1 : -1
  const absSteps = Math.abs(steps)
  const visualShift = dirSign * Math.min(absSteps, NAV_VISUAL_CAP)

  isResidualNav.set(true)
  outStartDrag.set(0)
  lastNavDir.set(dirSign < 0 ? 'l' : 'r')
  dragActive.set(true)
  focusedEventId.set(id)
  dragProgress.set(-visualShift)

  const duration = Math.min(
    640,
    RELEASE_ANIM_MS + 70 * (Math.abs(visualShift) - 1),
  )
  animateDragTo(0, duration)
}

// ─── Hover ───────────────────────────────────────────

let hoverClearTimer: number | null = null

export function setHoverEvent(id: string | null): void {
  if (id == null) {
    if (hoverClearTimer != null) clearTimeout(hoverClearTimer)
    hoverClearTimer = window.setTimeout(() => {
      hoveredEventId.set(null)
      hoverClearTimer = null
    }, 80)
    return
  }
  if (hoverClearTimer != null) {
    clearTimeout(hoverClearTimer)
    hoverClearTimer = null
  }
  hoveredEventId.set(id)
}

// ─── Timeline state machine ─────────────────────────

export function revealTimeline(): void {
  if (timelineState.peek() === 'hidden') {
    timelineState.set('expanded')
  }
}

export function hideTimeline(): void {
  // `focusedEventId` is left intact, re-opening the
  // history brings back the version the user was on.
  // `activeSnapshot` shelves it while `timelineState`
  // is hidden so the page reads as "live" in the
  // meantime.
  hoveredEventId.set(null)
  timelineState.set('hidden')
}

export function clickDot(id: string): void {
  navByEventId(id)
  timelineState.set('expanded')
}

export function closeDetails(): void {
  if (timelineState.peek() === 'expanded') hideTimeline()
}

export function openFullTimeline(): void {
  timelineState.set('full')
}

export function closeFullTimeline(): void {
  if (timelineState.peek() === 'full') {
    timelineState.set('expanded')
  }
}
