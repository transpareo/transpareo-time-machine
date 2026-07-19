/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Authenticated read path for category-3 (private) property
 * rows. The manifest's per-version entry carries
 * `privateProperties: { url: '...' }` when the version has
 * rows the public CDN snapshot omits; this module owns the
 * fetch, the per-version row cache, and the same-registrable-
 * site guard that pins the auth realm to the page's own host.
 *
 * The SPA never handles credentials. Authentication is a
 * full-page hand-off: on a 401 the endpoint names a login URL
 * (X-Auth-Url); the "Sign in" affordance redirects the whole
 * page there with a `return` param, and the authorising
 * system runs its own flow (eIDAS, SSO, a wallet), sets its
 * session, and returns the user. On return the page reloads,
 * this fetch re-runs with the session cookie, and the rows
 * merge in. No form, no credential POST, no token handling.
 *
 * Status branching, on every fetch of the URL:
 *
 *   200 -> rows for this user land in fetchState as
 *          { status: 'ok', rows } and merge into the
 *          rendered list.
 *   204 -> { status: 'empty' }; the user is signed in but
 *          has no group-or-plan access for this version.
 *   401 -> { status: 'unauth', loginUrl }; the renderer
 *          surfaces the sign-in affordance, which redirects
 *          to loginUrl. A 401 with no (or a cross-site) login
 *          URL leaves loginUrl undefined and no button shows.
 *   anything else -> { status: 'error', reason }; the
 *          renderer surfaces a "temporarily unavailable"
 *          affordance with a retry button.
 *
 * Both the read URL and the login URL must share a
 * registrable domain with location.origin: the session lives
 * on the publisher's own host, and the login redirect is held
 * to the same site so a compromised CDN edge can't turn the
 * affordance into an open redirect. A cross-site URL silently
 * drops (fail closed).
 *
 * Per-DPP session eviction: a 401 from a scrub-fetch after we
 * already had `ok` entries for other versions means the
 * session expired mid-scrub. We evict every cached version so
 * stale rows don't stay visible against a session that no
 * longer authorises the user.
 */

import { signal, effect } from '@/reactive/signals'
import { manifest, adaptPrivateRows, type WireProperty } from '@/host'
import { activeVersionNumber } from '@/state'
import type { PropertyValue } from '@/types'
import { describeError } from '@/errors'

// Per-version state of the private-properties fetch. Drives
// the renderer's per-version branch (merge, show-nothing,
// sign-in redirect, retry-affordance).
export type PrivateFetchState =
  | { readonly status: 'pending' }
  | { readonly status: 'ok'; readonly rows: ReadonlyArray<PropertyValue> }
  | { readonly status: 'empty' }
  | { readonly status: 'unauth'; readonly loginUrl?: string }
  | { readonly status: 'error'; readonly reason: string }

export const fetchStateByVersion =
  signal<Record<number, PrivateFetchState>>({})

// Versions whose URL the bootstrap effect already kicked off.
// Without this the effect would re-fire on every scrub even
// when we already have a verdict for the version.
const attempted = new Set<number>()

// Drop every per-boot piece of private-row state. Called by
// the root element when a later `src` reboots it: cached rows
// and the attempted set belong to the previous DPP. The
// bootstrap effect stays armed (it reacts to the new manifest
// signals).
export function resetPrivateState(): void {
  fetchStateByVersion.set({})
  attempted.clear()
}

let bootstrapped = false

export function bootstrapPrivateRowsFetch(): void {
  if (bootstrapped) return
  bootstrapped = true

  // React to manifest + active-version changes. When the
  // current version's entry advertises a privateProperties.url
  // and we haven't yet tried it, kick off a silent fetch.
  // Status branching writes a PrivateFetchState into
  // fetchStateByVersion; the renderer subscribes to that.
  effect(() => {
    const m = manifest()
    const n = activeVersionNumber()
    if (!m || n == null) return
    if (attempted.has(n)) return
    const entry = m.versions.find((v) => v.number === n)
    const url = entry?.privateProperties?.url
    if (!url) return
    attempted.add(n)
    void fetchPrivateRows(n, url)
  })
}

// The endpoint serves the full ordered property set in the
// wire shape. Accept either key the backend emits it under.
interface PrivateResponseBody {
  readonly properties?: ReadonlyArray<WireProperty>
  readonly privateProperties?: ReadonlyArray<WireProperty>
}

export async function fetchPrivateRows(
  versionNumber: number, url: string,
): Promise<PrivateFetchState['status']> {
  if (isCrossSiteUrl(url)) {
    // The manifest advertised a read URL outside the page's
    // registrable domain (a relative URL resolves to the page
    // origin and is always allowed). The session cookie realm
    // is the page's own host, so a foreign host can't be
    // authenticated against. Fail closed: drop the fetch, log
    // to the debug channel, render the public-only view.
    console.warn(`[private] cross-site URL ignored: ${url}`)
    return 'error'
  }

  setState(versionNumber, { status: 'pending' })
  let res: Response
  try {
    res = await fetch(url, { credentials: 'include' })
  } catch (err) {
    const reason = describeError(err)
    console.warn(`[private] fetch failed: ${reason}`)
    return setState(versionNumber, { status: 'error', reason })
  }

  if (res.status === 204) {
    return setState(versionNumber, { status: 'empty' })
  }

  if (res.status === 401) {
    // Not signed in. The endpoint names where to authenticate;
    // the affordance redirects the whole page there. Evict any
    // rows cached under a now-expired session.
    const loginUrl = parseLoginUrl(res)
    evictAllOkEntries()
    return setState(versionNumber, {
      status: 'unauth', ...(loginUrl ? { loginUrl } : {}),
    })
  }

  if (!res.ok) {
    const reason = `HTTP ${res.status}`
    console.warn(`[private] ${reason} from ${url}`)
    return setState(versionNumber, { status: 'error', reason })
  }

  let body: PrivateResponseBody
  try {
    body = await res.json() as PrivateResponseBody
  } catch (err) {
    const reason = describeError(err)
    console.warn(`[private] bad JSON: ${reason}`)
    return setState(versionNumber, { status: 'error', reason })
  }
  const rows = adaptPrivateRows(body.properties ?? body.privateProperties ?? [])
  return setState(versionNumber, { status: 'ok', rows })
}

// Re-attempt the fetch from the retry affordance. Always
// re-fetches even if a state already exists, so a transient
// 5xx can be retried; a returning user's authenticated reload
// goes through bootstrap instead.
export async function requestPrivateRowsFetch(): Promise<void> {
  const m = manifest.peek()
  const n = activeVersionNumber()
  if (!m || n == null) return
  const entry = m.versions.find((v) => v.number === n)
  const url = entry?.privateProperties?.url
  if (!url) return
  await fetchPrivateRows(n, url)
}

// The login URL a 401 advertises via X-Auth-Url. Held to the
// page's registrable site: the affordance navigates the whole
// page there, so a cross-site (or scheme-less, e.g. a
// javascript:) target is dropped to keep a compromised edge
// from turning the button into an open redirect. A relative
// URL resolves to the page origin and passes. Exported for
// unit testing.
export function parseLoginUrl(res: Response): string | null {
  const url = res.headers.get('X-Auth-Url')
  if (!url) return null
  if (isCrossSiteUrl(url)) {
    console.warn(`[private] cross-site login URL ignored: ${url}`)
    return null
  }
  return url
}

function setState(
  versionNumber: number, state: PrivateFetchState,
): PrivateFetchState['status'] {
  fetchStateByVersion.update((m) => ({ ...m, [versionNumber]: state }))
  return state.status
}

// Drop every previously-cached `ok` entry. Called on any 401:
// the session expired (or never existed), so rows that arrived
// under a previous session are no longer authoritative. Only
// the dropped versions are removed from `attempted`;
// 'unauth'/'error' versions stay flagged so the bootstrap
// effect doesn't re-fetch a 401 on every scrub-back to them.
function evictAllOkEntries(): void {
  const evicted: number[] = []
  fetchStateByVersion.update((m) => {
    let changed = false
    const next: Record<number, PrivateFetchState> = {}
    for (const [k, v] of Object.entries(m)) {
      if (v.status === 'ok') {
        evicted.push(Number(k))
        changed = true
        continue
      }
      next[Number(k)] = v
    }
    return changed ? next : m
  })
  for (const v of evicted) attempted.delete(v)
}

// Same-registrable-site check. The design pins the auth realm
// to the page's eTLD+1, so the URL must be the same host as
// the page OR one host sitting at-or-below the other in DNS
// hierarchy. Equivalent to "one is equal to or a subdomain of
// the other," which doesn't need the Public Suffix List and
// rejects the typical cross-site rewrite attack (acme.com
// page, attacker.com URL) without over-matching on country
// TLDs the way a naive "last-two-labels" heuristic would.
//
// `pageHostname` is taken from `window.location` at the caller
// side; exposed as a parameter so unit tests can pass it
// explicitly without mocking globals.
export function isSameRegistrableSite(
  url: string, pageHostname: string,
): boolean {
  if (!pageHostname) return false

  // isCrossSiteUrl resolves relative inputs against the page
  // origin before calling in, so this only ever sees a
  // fully-qualified URL; parsing without a base rejects the
  // scheme-less / malformed cases a same-site guard can't
  // honestly check.
  let endpoint: URL
  try {
    endpoint = new URL(url)
  } catch {
    return false
  }
  const page = pageHostname.toLowerCase()
  const cand = endpoint.hostname.toLowerCase()
  if (!page || !cand) return false
  if (page === cand) return true

  // The shorter side (the would-be parent domain) must itself
  // carry at least two labels: without this, `foo.example.ai`
  // on the page would accept an endpoint at the bare
  // registrable host `ai`.
  if (page.endsWith('.' + cand) && cand.includes('.')) return true
  if (cand.endsWith('.' + page) && page.includes('.')) return true
  return false
}

// True when a URL resolves to a different registrable site
// than the page. Relative and scheme-relative URLs are
// resolved against the page origin first, so a same-origin
// path passes. Outside a browser (SSR / tests) there is no
// credential realm to protect, so the guard is a no-op.
function isCrossSiteUrl(url: string): boolean {
  if (typeof window === 'undefined') return false
  let resolved: URL
  try {
    resolved = new URL(url, window.location.href)
  } catch {
    return true
  }
  return !isSameRegistrableSite(resolved.href, window.location.hostname)
}
