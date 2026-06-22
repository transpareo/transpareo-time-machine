/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The shared signal store. Every component reads from
 * here; mutations live in `actions.ts`, gesture input
 * lives in `gestures.ts`, one-shot lifecycle in
 * `bootstrap.ts`. This file is *just* signals + the
 * computed derivations that fan out from them.
 *
 * The actual fetch flow lives in `src/host.ts`. State
 * here is a thin layer of derivations on top of the
 * host signals (manifest, snapshots, events, EPCIS).
 * Components that read the derivations expect data to
 * be loaded; the root `<transpareo-time-machine>`
 * element gates mounting on `host.loadState === 'ready'`
 * so consumers never see a null underneath.
 */
import { signal, computed } from '@/reactive/signals'
import type {
  DppEvent, DppProduct, DppSnapshot, EventType, LifecycleStatus,
  PropertyValue,
} from '@/types'
import * as host from '@/host'
import type { VersionState } from '@/archive'
import { eventTime, type EpcisObjectEvent } from '@/epcis'
import type { ProofEntryResult } from '@/crypto/verify'

// ---- Active archive (manifest is the entry-point
// artefact; events sidecar and EPCIS document are
// fetched alongside the current snapshot).
export const manifest = host.manifest
export const epcisDocument = host.epcisDocument
export const versionStates =
  signal<Record<number, VersionState>>({})

// Verdict of a single platform signature bound to a whole
// artefact: the manifest's version list, or the events
// sidecar. 'pending' until the check resolves; 'absent'
// when the artefact carries no signature; otherwise the
// resolved proof entry result.
export type SignatureProofState = ProofEntryResult | 'absent' | 'pending'

// Manifest version-list signature (shared across versions).
export const manifestProofState = signal<SignatureProofState>('pending')

// Events sidecar (EPCIS document) signature. Verified once
// at boot; surfaced in the proof modal alongside the
// manifest signature.
export const eventsProofState = signal<SignatureProofState>('pending')

// Lookup table keyed by `transpareo:dppEventId` so a
// DppEvent row can resolve its matching EPCIS event in
// O(1) without re-scanning the eventList on every read.
export const epcisByEventId = computed<
  Record<string, EpcisObjectEvent>
>(() => {
  const out: Record<string, EpcisObjectEvent> = {}
  const doc = epcisDocument()
  if (!doc) return out
  for (const ev of doc.epcisBody.eventList) {
    const id = ev['transpareo:dppEventId']
    if (typeof id === 'string') out[id] = ev
  }
  return out
})

// ---- Event list, derived from the EPCIS document.
// The backend publishes a single events sidecar (the
// EPCIS file, served at `manifest.epcisUrl`), with the
// renderer-specific fields carried as `transpareo:*`
// extensions on each ObjectEvent. The public artefact
// is PII-clean: actorLabel and description are absent
// in production and overlaid only in the authority-
// tool embed via a separate authenticated fetch (see
// docs/backend/authority-events.md).
//
// Filter on `private` is defensive against an issuer
// mis-publishing a regulator-only event into the
// public feed.
export const events = computed<ReadonlyArray<DppEvent>>(() => {
  const doc = epcisDocument()
  if (!doc) return []
  const out: DppEvent[] = []
  for (const ev of doc.epcisBody.eventList) {
    const event = epcisToDppEvent(ev)
    if (event && !event.private) out.push(event)
  }
  return out
})

function epcisToDppEvent(ev: EpcisObjectEvent): DppEvent | null {
  const id = ev['transpareo:dppEventId']
  const eventType = ev['transpareo:eventType']
  if (typeof id !== 'string' || typeof eventType !== 'string') {
    return null
  }
  const versionNumber = ev['transpareo:versionNumber']
  const statusFrom = ev['transpareo:statusFrom']
  const statusTo = ev['transpareo:statusTo']
  const actorLabel = ev['transpareo:actorLabel']
  const description = ev['transpareo:description']
  return {
    id,
    eventType: eventType as EventType,
    occurredAt: ev.eventTime,
    ...(typeof actorLabel === 'string' ? { actorLabel } : {}),
    ...(typeof statusFrom === 'string'
      ? { statusFrom: statusFrom as LifecycleStatus } : {}),
    ...(typeof statusTo === 'string'
      ? { statusTo: statusTo as LifecycleStatus } : {}),
    ...(isLocalizedText(description) ? { description } : {}),
    ...(typeof versionNumber === 'number' ? { versionNumber } : {}),
  }
}

function isLocalizedText(
  value: unknown,
): value is string | Readonly<Record<string, string>> {
  if (typeof value === 'string') return true
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>)
      .every((v) => typeof v === 'string')
  }
  return false
}

export const sortedEvents = computed<ReadonlyArray<DppEvent>>(
  () => [...events()].sort(
    (a, b) => eventTime(a.occurredAt) - eventTime(b.occurredAt),
  ),
)

// ---- Focus & hover.
export const focusedEventId = signal<string | null>(null)
export const hoveredEventId = signal<string | null>(null)

export const focusedEvent = computed(() => {
  const id = focusedEventId()
  return id
    ? events().find((e) => e.id === id) ?? null
    : null
})

export const focusIndex = computed(() => {
  const id = focusedEventId()
  const list = sortedEvents()
  if (!id) return list.length - 1
  const idx = list.findIndex((e) => e.id === id)
  return idx >= 0 ? idx : list.length - 1
})

// Visitor is "on current" whenever the displayed
// snapshot matches the live one. True while the
// timeline is hidden (activeSnapshot shelves the
// focused id and the page reads as live), and also
// true when the focused event is at or after the
// latest publication: e.g. clicking the most recent
// inspection chip resolves to the latest version
// because nothing was published in between, so the
// page shows current content and the "historical
// view" badge would be misleading.
export const isOnCurrent = computed(() =>
  timelineState() === 'hidden'
  || activeVersionNumber() === latestVersion(),
)

// ---- Active version (drives chip + lazy verify). In
// manifest mode this mirrors the manifest's currentVersion;
// in single-snapshot mode it is the lone snapshot's version.
// `host.currentVersion` carries both.
export const latestVersion = computed(() => host.currentVersion())

// When the focused event has its own versionNumber
// (i.e. it triggered a publish), use that. Otherwise,
// an inspection, ownership-transfer or other non-
// publishing event, walk back through the timeline
// to find the most recent publication AT or before the
// focused event's timestamp. That's the DPP state as it
// stood when the inspection happened, not whatever the
// newest publication happens to be today.
export const activeVersionNumber = computed<number>(() => {
  const fe = focusedEvent()
  if (!fe) return latestVersion()
  if (fe.versionNumber != null) return fe.versionNumber

  const list = sortedEvents()
  const focusTime = eventTime(fe.occurredAt)
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]
    if (
      e.versionNumber != null
      && eventTime(e.occurredAt) <= focusTime
    ) {
      return e.versionNumber
    }
  }
  return latestVersion()
})

// ---- Snapshot resolution + rendered product.
// activeSnapshot is the single source of truth for the
// rendered page: each per-version artefact is self-
// contained (issuer + product + composition + events-
// scoped fields + proof) so renderedProduct collapses
// to a pass-through of activeSnapshot.product.
//
// These derivations are non-null because the root
// `<transpareo-time-machine>` element gates mounting
// of the inner tree on `host.loadState === 'ready'`.
// Calling any of them before data is loaded throws,
// and components only subscribe to them after the
// element has connected them to the DOM, so the
// invariant holds at runtime.
const currentSnapshot = computed<DppSnapshot>(
  () => requireSnapshot(host.snapshots()[latestVersion()], 'current'),
)

export function snapshotForVersion(v: number | undefined): DppSnapshot | null {
  if (v == null) return null
  return host.snapshots()[v] ?? null
}

export const activeSnapshot = computed<DppSnapshot>(() => {
  if (timelineState() === 'hidden') return currentSnapshot()

  // Mobile swipe preview: setupOverlay in dpp-deck sets
  // previewEventId to the swipe target so the live
  // .card (behind the overlay clone) renders that
  // version's content while the gesture is still open.
  // focusedEventId stays put; only a completed commit
  // moves the actual focus.
  const previewId = previewEventId()
  if (previewId) {
    const preview = events().find((e) => e.id === previewId)
    const snap = snapshotForVersion(preview?.versionNumber)
    if (snap) return snap
  }

  return snapshotForVersion(focusedEvent()?.versionNumber)
    ?? currentSnapshot()
})

export const renderedProduct = computed<DppProduct>(
  () => activeSnapshot().product,
)

// Flat data rows the renderer reads off the active
// snapshot. Each row's `value.type` chooses the
// presentation surface; `namespace` + `onDemand`
// carry access-gating. Reads directly off
// snapshot.properties - no derivation step.
export const renderedPresentation = computed<ReadonlyArray<PropertyValue>>(
  () => activeSnapshot().properties,
)

// Convenience: the issuer carried on the active
// snapshot. Read by the brandbar, footer, and
// verification modal.
export const activeIssuer = computed(
  () => activeSnapshot().issuer,
)

// The platform's display name read off the active
// snapshot. The verification modal labels the platform
// authority with this so the proof chain stays in sync
// with whatever the issuer signed against, no hardcoded
// brand fallback.
export const activePlatform = computed(
  () => activeSnapshot().platform,
)

// The verification verdict for the active version, as the
// chip reads it. A preview of a not-yet-published passport is
// a draft AND unsigned (no proof set), so it has nothing to
// verify: it resolves to 'draft' rather than spinning on
// 'pending' forever or tripping the proof gate into a
// misleading 'failed'.
//
// Both conditions are required, not just the status: a
// published snapshot always carries a proof, and
// canonicalStatus falls back to 'draft' for an absent or
// unrecognised dppStatus, so a status check alone would hide
// a real verdict behind "draft" the moment the backend grows
// a lifecycle token this build doesn't know. Gating on the
// empty proof set keeps the short-circuit to genuine,
// unsigned previews.
export const verifyResult = computed<
  'pending' | 'verified' | 'failed' | 'draft'
>(() => {
  const snap = activeSnapshot()
  if (snap.status === 'draft' && snap.proof.length === 0) return 'draft'
  return versionStates()[activeVersionNumber()]?.status ?? 'pending'
})

// ---- Available locales for the language picker. In
// manifest mode the publisher declares them; in single-
// snapshot mode (no manifest) derive them from the locale
// keys present in the snapshot's localized strings (name /
// description / category / property names). Also covers a
// manifest that omits the list.
export const availableLocales = computed<ReadonlyArray<string>>(() => {
  const declared = manifest()?.availableLocales
  if (declared && declared.length) return declared
  return localesFromSnapshot(activeSnapshot())
})

function localesFromSnapshot(
  snap: DppSnapshot,
): ReadonlyArray<string> {
  const set = new Set<string>()
  const collect = (text: unknown): void => {
    if (text && typeof text === 'object' && !Array.isArray(text)) {
      for (const key of Object.keys(text)) set.add(key)
    }
  }
  collect(snap.product.name)
  collect(snap.product.description)
  collect(snap.product.category)
  for (const row of snap.properties) collect(row.name)
  return [...set].sort()
}

function requireSnapshot(
  s: DppSnapshot | undefined, which: string,
): DppSnapshot {
  if (!s) {
    throw new Error(`state.${which}Snapshot read before data loaded`)
  }
  return s
}

// ---- Timeline visual state machine.
// hidden   -> live card only. Centred "See N versions"
//             button above the card. Deck shadows are
//             not rendered (saves compute).
// expanded -> strip + year labels + dots, with the
//             event-details panel below. The deck
//             shadow stack animates into view.
// full     -> all event cards in a two-row layout
//             below the strip, no details panel.
export type TimelineState = 'hidden' | 'expanded' | 'full'

export const timelineState =
  signal<TimelineState>('hidden')

// Display surface for the event-details panel.
// Hover takes precedence over focus, which beats the
// implicit "latest" so the panel always has content
// while the timeline is expanded.
export const displayedEvent = computed<DppEvent | null>(() => {
  const list = sortedEvents()
  const hover = hoveredEventId()
  if (hover) {
    return list.find((e) => e.id === hover) ?? null
  }
  const focus = focusedEventId()
  if (focus) {
    return list.find((e) => e.id === focus) ?? null
  }
  return list.length ? list[list.length - 1] : null
})

// ---- Viewport-driven layout switch.
// Single source of truth for the responsive cut-over to
// the mobile presentation: full-bleed live card, no
// shadow stack, horizontal-only drag with a peek
// behind. Threshold matches the .card breakpoint in
// transpareo-time-machine.scss.
const MOBILE_BREAKPOINT_PX = 830
export const isMobile = signal<boolean>(
  typeof window !== 'undefined'
    && window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches,
)
if (typeof window !== 'undefined') {
  const mql = window.matchMedia(
    `(max-width: ${MOBILE_BREAKPOINT_PX}px)`,
  )
  mql.addEventListener('change', (e) => isMobile.set(e.matches))
}

// Preview of the version the live card should render
// during a mobile swipe. Decoupled from focusedEventId
// so the timeline dot doesn't flash to the target until
// the swipe actually commits. `activeSnapshot` reads
// this; everything else (focusIndex, displayedEvent,
// verifyResult) stays tied to focusedEventId.
export const previewEventId = signal<string | null>(null)

// ---- Deck drag / multi-step animation state.
//
// `dragProgress in [-N, N]`: negative pulls the deck
// toward the next/newer slot; positive toward older.
// During a gesture the value tracks input; on release
// the residual eases back to 0 (commit or abort) via
// `actions.animateDragTo`.
export const SHADOW_DEPTH_CAP = 5
export const NAV_VISUAL_CAP = 12
export const RELEASE_ANIM_MS = 200

export const dragProgress = signal(0)
export const dragActive = signal(false)
export const isResidualNav = signal(false)
export const outStartDrag = signal(0)
export const lastNavDir = signal<'l' | 'r'>('l')

// ---- Boot reset.
// Returns every per-boot signal to its initial value.
// Called by the root element when a later `src` attribute
// reboots it (host.bootFrom clears the host caches; this
// clears the derivation layer's own state so DPP A's
// verdicts, focus, and gesture state don't leak into
// DPP B). Viewport state (isMobile) is boot-independent.
export function resetBootState(): void {
  versionStates.set({})
  manifestProofState.set('pending')
  eventsProofState.set('pending')
  focusedEventId.set(null)
  hoveredEventId.set(null)
  previewEventId.set(null)
  timelineState.set('hidden')
  dragProgress.set(0)
  dragActive.set(false)
  isResidualNav.set(false)
  outStartDrag.set(0)
}

// ---- Re-export the version state types so child
// components can import them without reaching into
// `archive`.
export type { VersionState }
