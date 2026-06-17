/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One-shot lifecycle: arms the lazy-verify effect and
 * wires the URL hash to / from focusedEventId. The root
 * element calls these in its `setup()`. The manifest,
 * per-version snapshots, and EPCIS document are fetched
 * over the network by host.ts; this module only reacts to
 * what host.ts has loaded.
 */
import { effect } from '@/reactive/signals'
import {
  focusedEventId, activeVersionNumber, timelineState,
} from '@/state'
import { ensureVersionLoaded, navByEventId } from '@/actions'
import { manifest } from '@/host'

// Number of versions on either side of the active
// version to prefetch + verify when the visitor opens
// the timeline. Gives a scrub one or two steps away a
// warm cache so the per-step render holds 60 fps
// instead of waiting on a CDN round-trip.
const PREFETCH_WINDOW = 3

// ─── Lazy verify ─────────────────────────────────────

// Verify on every scrub so the chip flips "verifying"
// -> "verified" / "failed" without us wiring the call
// into every nav site. The badge reflects only the
// currently-viewed version, historical versions get
// verified when the user opens the proof modal (see
// dpp-verification-modal.ts).
//
// Prefetch is gated on the timeline being open. The
// common visit - scan QR, read the current page,
// leave - never opens the timeline and pays for
// exactly one snapshot fetch. The moment the timeline
// expands, we warm the cache for the PREFETCH_WINDOW
// versions on either side of the active one so the
// first scrub doesn't pay a per-step CDN round-trip.
// ensureVersionLoaded is idempotent, so subsequent
// scrubs across the same window are free, and
// re-opening the timeline doesn't re-fetch.
export function bootstrapVerify(): void {
  if (lazyVerifyArmed) return
  lazyVerifyArmed = true
  effect(() => {
    const n = activeVersionNumber()

    // 0 is the host's cleared currentVersion while a boot
    // (or reboot) is loading; there is no version 0 to
    // verify, so don't seed a junk entry for it.
    if (!n) return
    ensureVersionLoaded(n)
    if (timelineState() !== 'hidden') prefetchAround(n)
  })
}

function prefetchAround(active: number): void {
  const m = manifest.peek()
  if (!m) return
  const numbers = new Set(m.versions.map((v) => v.number))
  for (let i = 1; i <= PREFETCH_WINDOW; i++) {
    if (numbers.has(active + i)) ensureVersionLoaded(active + i)
    if (numbers.has(active - i)) ensureVersionLoaded(active - i)
  }
}

let lazyVerifyArmed = false

// ─── URL hash sync ───────────────────────────────────

let lastHashWritten: string | null = null

// Guard against re-entry: bootstrapHash is called from
// `<transpareo-time-machine>`'s setup, which can run more
// than once if the host re-mounts the custom element. Without
// this flag, each re-mount would stack another pair of
// `hashchange`/`popstate` listeners on window, firing
// navByEventId once per registered copy.
let hashBootstrapped = false

function parseHash(): string | null {
  if (typeof window === 'undefined') return null
  const h = window.location.hash
  return h && h !== '#' ? decodeURIComponent(h.slice(1)) : null
}

export function bootstrapHash(): void {
  if (typeof window === 'undefined') return
  if (hashBootstrapped) return
  hashBootstrapped = true

  // Initial hash -> focusedEventId. A non-empty hash is
  // a deep link to a specific version, so the timeline
  // opens straight into expanded mode.
  const initial = parseHash()
  focusedEventId.set(initial)
  if (initial) timelineState.set('expanded')

  // (focusedEventId, timelineState) -> hash. The hash is
  // only present while the history is visible, closing
  // the timeline clears the URL even though the focused
  // id sticks around in memory so re-opening can
  // restore it.
  effect(() => {
    const id = focusedEventId()
    const visible = timelineState() !== 'hidden'
    const target = (visible && id)
      ? '#' + encodeURIComponent(id)
      : ''
    if (window.location.hash === target) return
    if (lastHashWritten === target) return
    lastHashWritten = target
    const next = window.location.pathname
      + window.location.search + target
    window.history.pushState(null, '', next)
  })

  // hash -> focusedEventId + timelineState (back/forward).
  const onHash = (): void => {
    const next = parseHash()
    lastHashWritten = next ? '#' + encodeURIComponent(next) : ''
    navByEventId(next)
    timelineState.set(next ? 'expanded' : 'hidden')
  }
  window.addEventListener('hashchange', onHash)
  window.addEventListener('popstate', onHash)
}
