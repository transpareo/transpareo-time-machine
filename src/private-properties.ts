/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Authenticated read path for category-3 (private)
 * property rows. The manifest's per-version entry
 * carries `privateProperties: { url: '...' }` when the
 * version has rows the public CDN snapshot omits; this
 * module owns the fetch, the X-Auth-Fields negotiation,
 * the per-version row cache, and the same-origin guard
 * that pins the auth realm to the page's own
 * registrable domain.
 *
 * Status branching, on every fetch of the URL:
 *
 *   200 -> rows for this user land in fetchState as
 *          { status: 'ok', rows } and merge into the
 *          rendered list.
 *   204 -> { status: 'empty' }; the user is signed in
 *          but has no group-or-plan access for this
 *          version. The renderer adds nothing.
 *   401 -> { status: 'unauth' }; the renderer surfaces
 *          a "Sign in for additional product data"
 *          button. parseChallenge decodes the X-Auth-*
 *          headers; clicking the button opens the
 *          modal which submits credentials, on success
 *          retries the fetch.
 *   anything else -> { status: 'error', reason }; the
 *          renderer surfaces a "temporarily unavailable"
 *          affordance with a retry button. Manifest
 *          claimed there were rows; failure should not
 *          silently erase that claim.
 *
 * The whole pathway requires the privateProperties URL
 * to share a registrable domain with location.origin -
 * the auth realm lives on the publisher's own host. A
 * cross-site URL (compromised CDN edge, third-party
 * embed) silently drops the fetch and the renderer
 * shows the public-only view, matching the design's
 * "fail closed" stance.
 *
 * Per-DPP session eviction: a 401 from a scrub-fetch
 * after we already had `ok` entries for other versions
 * means the auth session expired mid-scrub. We evict
 * every previously-cached version so the renderer
 * doesn't keep stale rows visible against a session
 * that no longer authorises the user.
 *
 * Token-in-body fallback: a backend that returns
 * `{ "token": "..." }` in the POST response instead of
 * setting a session cookie has its token stashed in
 * memory and sent as `Authorization: Bearer ...` on
 * subsequent calls. The token does NOT touch
 * localStorage; it dies with the page.
 *
 * Modal close (cancelAuth) clears the challenge and the
 * pending submitted-values map so a re-open issues a
 * fresh fetch and renders whatever stage the backend
 * chooses to start from, never a stale OTP form.
 */

import { signal, effect } from '@/reactive/signals'
import { manifest, adaptPrivateRows, type WireProperty } from '@/host'
import { activeVersionNumber } from '@/state'
import type { PropertyValue } from '@/types'
import { describeError } from '@/errors'

export interface AuthFieldDescriptor {
  readonly name: string
  readonly type: 'email' | 'password' | 'text' | 'number'
  readonly required?: boolean
  readonly label?: string
  readonly hint?: string
}

export interface AuthChallenge {
  // Rails-served URL the SPA POSTs credentials to.
  readonly url: string

  // 'POST' today; the header is reserved for future
  // expansion.
  readonly method: string

  // 'application/json' or
  // 'application/x-www-form-urlencoded'. The SPA
  // encodes the posted body accordingly.
  readonly contentType: string
  readonly fields: ReadonlyArray<AuthFieldDescriptor>

  // X-Auth-Stage from the response. Discriminates a
  // "next stage" challenge (OTP after password) from a
  // "same stage, wrong password" retry. The modal
  // clears its inputs when stage advances and preserves
  // them across same-stage retries.
  readonly stage: number

  // X-Auth-Error from the previous attempt, if any.
  // The modal renders this above the form.
  readonly error?: string

  // The version + privateProperties URL the challenge
  // is gating; the modal needs them so submitAuth's
  // retry can attach the rows to the right cache entry.
  readonly versionNumber: number
  readonly privateUrl: string
}

// Per-version state of the private-properties fetch.
// Drives the renderer's per-version branch (merge,
// show-nothing, login-button, retry-affordance).
export type PrivateFetchState =
  | { readonly status: 'pending' }
  | { readonly status: 'ok'; readonly rows: ReadonlyArray<PropertyValue> }
  | { readonly status: 'empty' }
  | { readonly status: 'unauth' }
  | { readonly status: 'error'; readonly reason: string }

export const fetchStateByVersion =
  signal<Record<number, PrivateFetchState>>({})
export const challenge = signal<AuthChallenge | null>(null)

// In-memory bearer token for backends that opt for
// token-in-body instead of session cookies. Session-
// scoped only; never persisted.
let bearerToken: string | null = null

// Values from the most recent submitAuth call, retained
// so the modal can pre-fill the form on a same-stage
// retry (wrong password / OTP mismatch). Reset on
// cancelAuth and on stage advance.
let lastSubmittedValues: Record<string, string> = {}
export function getLastSubmittedValues(): Readonly<Record<string, string>> {
  return lastSubmittedValues
}

// Versions whose URL the bootstrap effect already
// kicked off. Without this the effect would re-fire on
// every scrub even when we already have a verdict for
// the version.
const attempted = new Set<number>()

// Drop every per-boot piece of auth/private-row state.
// Called by the root element when a later `src` reboots
// it: cached rows, the session token, and the attempted
// set all belong to the previous DPP. The bootstrap
// effect itself stays armed (it reacts to the new
// manifest signals).
export function resetPrivateState(): void {
  fetchStateByVersion.set({})
  challenge.set(null)
  bearerToken = null
  lastSubmittedValues = {}
  attempted.clear()
}

let bootstrapped = false

export function bootstrapPrivateRowsFetch(): void {
  if (bootstrapped) return
  bootstrapped = true

  // React to manifest + active-version changes. When the
  // current version's entry advertises a
  // privateProperties.url and we haven't yet tried it,
  // kick off a silent fetch. Status branching writes a
  // PrivateFetchState into fetchStateByVersion; the
  // renderer subscribes to that.
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
  if (!isSameRegistrableSite(url, currentPageHostname())) {
    // The manifest advertised a URL on a host outside
    // the page's registrable domain. The cookie realm
    // is the page's own host, so we can't authenticate
    // against it and a credential POST would be a
    // phishing surface. Per the design's fail-closed
    // stance: silently drop the fetch, don't write a
    // state entry, log to the debug channel only. The
    // renderer paints the public-only view as if the
    // version had no privateProperties.url at all.
    console.warn(`[private] cross-site URL ignored: ${url}`)
    return 'error'
  }

  setState(versionNumber, { status: 'pending' })
  let res: Response
  try {
    res = await fetch(url, {
      credentials: 'include',
      headers: bearerToken
        ? { Authorization: `Bearer ${bearerToken}` }
        : {},
    })
  } catch (err) {
    const reason = describeError(err)
    console.warn(`[private] fetch failed: ${reason}`)
    return setState(versionNumber, { status: 'error', reason })
  }

  if (res.status === 204) {
    return setState(versionNumber, { status: 'empty' })
  }

  if (res.status === 401) {
    // The session the token represented is over; without
    // this, every retry re-sends the dead header.
    bearerToken = null
    const ch = parseChallenge(res, versionNumber, url)
    if (ch) challenge.set(ch)
    evictAllOkEntries()
    return setState(versionNumber, { status: 'unauth' })
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
  challenge.set(null)
  return setState(versionNumber, { status: 'ok', rows })
}

// Submit the auth-modal form. Encodes per the
// challenge's contentType, POSTs with credentials, and
// retries the privateProperties fetch on success.
export async function submitAuth(
  values: Record<string, string>,
): Promise<'ok' | 'unauth' | 'error'> {
  const ch = challenge.peek()
  if (!ch) return 'error'

  lastSubmittedValues = { ...values }

  const body = ch.contentType === 'application/x-www-form-urlencoded'
    ? new URLSearchParams(values).toString()
    : JSON.stringify(values)

  let res: Response
  try {
    res = await fetch(ch.url, {
      method: ch.method,
      credentials: 'include',
      headers: {
        'Content-Type': ch.contentType,
        Accept: 'application/json',
      },
      body,
    })
  } catch (err) {
    console.warn(`[private] auth POST failed: ${describeError(err)}`)
    challenge.set({ ...ch, error: describeError(err) })
    return 'error'
  }

  if (res.status === 401) {
    const next = parseChallenge(res, ch.versionNumber, ch.privateUrl)
    if (next) {
      // Stage advanced -> the backend wants a different
      // factor (e.g. OTP after password). Clear the
      // pre-fill buffer so the modal renders blank
      // inputs for the new round.
      if (next.stage !== ch.stage) lastSubmittedValues = {}
      challenge.set(next)
    }
    return 'unauth'
  }

  if (!res.ok) {
    challenge.set({ ...ch, error: `HTTP ${res.status}` })
    return 'error'
  }

  // Token-in-body? Stash for the bearer header on the
  // retry. Empty / non-JSON 2xx responses are fine on
  // cookie-only backends; the cookie was already
  // accepted by the browser.
  try {
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      const j = await res.json() as { token?: unknown }
      if (typeof j.token === 'string' && j.token.length > 0) {
        bearerToken = j.token
      }
    }
  } catch {
    // No body / non-JSON response is fine.
  }

  // Re-fetch the URL the challenge was gating; the
  // outcome goes through the normal status branch.
  const next = await fetchPrivateRows(
    ch.versionNumber, ch.privateUrl,
  )
  if (next === 'ok' || next === 'empty') {
    lastSubmittedValues = {}
    return 'ok'
  }
  return next === 'unauth' ? 'unauth' : 'error'
}

// Re-attempt the fetch from a UI affordance (login
// button or retry button). Always re-fetches even if a
// state already exists, so a 5xx can be retried and a
// 401 can be reopened with a fresh stage-1 challenge.
export async function requestPrivateRowsFetch(): Promise<void> {
  const m = manifest.peek()
  const n = activeVersionNumber()
  if (!m || n == null) return
  const entry = m.versions.find((v) => v.number === n)
  const url = entry?.privateProperties?.url
  if (!url) return
  await fetchPrivateRows(n, url)
}

// Close the auth modal without authenticating. Clears
// the in-flight challenge and the pre-fill buffer so a
// re-open re-runs the fetch and renders whatever stage
// the backend hands back.
export function cancelAuth(): void {
  challenge.set(null)
  lastSubmittedValues = {}
}

// Header-driven challenge parse. Missing or malformed
// headers return null so the caller can fall back to a
// generic error message instead of opening an unusable
// modal. Exported for direct unit testing.
export function parseChallenge(
  res: Response, versionNumber: number, privateUrl: string,
): AuthChallenge | null {
  const url = res.headers.get('X-Auth-Url')
  const method = res.headers.get('X-Auth-Method') ?? 'POST'
  const contentType =
    res.headers.get('X-Auth-Content-Type') ?? 'application/json'
  const fieldsHeader = res.headers.get('X-Auth-Fields')
  if (!url || !fieldsHeader) return null

  // The credential POST runs with credentials: 'include',
  // so hold its target to the same registrable site as the
  // page, mirroring the read-path guard. A relative
  // X-Auth-Url is same-origin by construction and always
  // allowed; an absolute one that resolves off-site is
  // dropped (a misconfigured or compromised backend trying
  // to redirect credentials elsewhere).
  if (isCrossSiteUrl(url)) {
    console.warn(`[private] cross-site auth URL ignored: ${url}`)
    return null
  }

  let fields: ReadonlyArray<AuthFieldDescriptor>
  try {
    const parsed = JSON.parse(fieldsHeader) as ReadonlyArray<AuthFieldDescriptor>
    if (!Array.isArray(parsed)) return null
    fields = parsed
  } catch {
    return null
  }

  const stage = parseStage(res.headers.get('X-Auth-Stage'))
  return {
    url, method, contentType, fields, stage,
    error: readError(res),
    versionNumber, privateUrl,
  }
}

function parseStage(raw: string | null): number {
  if (!raw) return 1
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function readError(res: Response): string | undefined {
  return res.headers.get('X-Auth-Error') ?? undefined
}

function setState(
  versionNumber: number, state: PrivateFetchState,
): PrivateFetchState['status'] {
  fetchStateByVersion.update((m) => ({ ...m, [versionNumber]: state }))
  return state.status
}

// Drop every previously-cached `ok` entry. Called on
// any 401: the auth session expired (or never existed),
// so rows that arrived under a previous session are no
// longer authoritative. Only the dropped versions are
// removed from `attempted`; versions whose state is
// 'unauth' or 'error' stay flagged so the bootstrap
// effect doesn't immediately re-fetch a 401 on every
// scrub-back to that version.
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

// Same-registrable-site check. The design pins the auth
// realm to the page's eTLD+1, so the privateProperties
// URL must be the same host as the page OR one host
// sitting at-or-below the other in DNS hierarchy.
// Equivalent to "one is equal to or a subdomain of the
// other," which doesn't need the Public Suffix List
// and rejects the typical cross-site rewrite attack
// (acme.com page, attacker.com URL) without
// over-matching on country TLDs the way a naive
// "last-two-labels" heuristic would.
//
// `pageHostname` is taken from `window.location` at the
// caller side; exposed as a parameter so unit tests can
// pass it explicitly without mocking globals.
export function isSameRegistrableSite(
  url: string, pageHostname: string,
): boolean {
  if (!pageHostname) return false

  // The manifest field is always a fully-qualified
  // absolute URL by design (ManifestPublisher emits
  // `https://host/path`, never relative). Parsing
  // without a base rejects relative / scheme-less /
  // malformed inputs that a same-site guard cannot
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

  // The shorter side (the would-be parent domain) must
  // itself carry at least two labels: without this,
  // `foo.example.ai` on the page would accept an endpoint
  // at the bare registrable host `ai`.
  if (page.endsWith('.' + cand) && cand.includes('.')) return true
  if (cand.endsWith('.' + page) && page.includes('.')) return true
  return false
}

function currentPageHostname(): string {
  if (typeof window === 'undefined') return ''
  return window.location.hostname
}

// True when an X-Auth-Url resolves to a different
// registrable site than the page. Relative and
// scheme-relative URLs are resolved against the page origin
// first, so a same-origin path passes. Outside a browser
// (SSR / tests) there is no credential realm to protect, so
// the guard is a no-op.
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
