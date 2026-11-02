/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Kill switch for the SPA's pinned platform key.
 *
 * A CDN-hosted SPA bundle can outlive its trust
 * anchor: forks and mirrors keep serving v1.0.0 long
 * after the platform's Ed25519 signing key was leaked
 * or rotated. Without a revocation channel, an old
 * bundle would happily verify snapshots under the
 * compromised key and render the green "verified"
 * chip.
 *
 * Mechanism:
 *
 *   1. The host page (or the bundle's defaults) pins
 *      one or more publicKeyMultibase values via
 *      config.pinnedPlatformKeys (rotation keeps
 *      retired-but-sound roots in the set).
 *   2. At boot the bundle fetches
 *      config.revokedRootsUrl (default:
 *      /.well-known/dpp-revoked-roots.json on the host
 *      `asset-host` names, which a static copy carries as
 *      at packaging; without that attribute,
 *      https://transpareo.com/.well-known/dpp-revoked-roots.json).
 *      The list is trusted on that host's HTTPS. The
 *      platform signs it (a `proof` array) for auditors
 *      checking a copy offline; only the fingerprints
 *      are read here.
 *   3. Each entry's fingerprint is compared against
 *      SHA-256(decoded multikey bytes) of every
 *      pinned key. The wire format prefixes the hex
 *      with `sha256:` as the well-known endpoint
 *      serves it; we strip it before comparing.
 *   4. Any match -> revocationStatus = 'revoked', and
 *      every snapshot verdict downstream is forced
 *      to 'unauthenticated'. The shell drops
 *      compromised keys from the attribute, so a hit
 *      on ANY pin means a stale shell or bundle is
 *      being served - exactly the attack the check
 *      exists for.
 *   5. Network error / non-2xx -> one retry after a
 *      short delay, then revocationStatus =
 *      'unreachable'. Pinned builds fail closed on it
 *      (actions.ts forces every verdict to failed):
 *      the network attacker the pin defends against
 *      could otherwise keep a revoked key trusted by
 *      blocking exactly this fetch. A document that is
 *      no revocation list settles 'unreachable' at once.
 *   6. No pin in config -> revocationStatus =
 *      'unpinned'; the fetch is skipped because there
 *      is nothing to compare against.
 *
 * Forks: set `revoked-roots-src=""` to disable the
 * fetch (e.g. dev / offline kiosks), or point it at
 * the fork's own well-known endpoint.
 */

import { signal } from '@/reactive/signals'
import { config } from '@/config'
import { assetBase } from '@/host'
import { describeError } from '@/errors'
import { decodeMultibaseBase58 } from '@/crypto/multibase'

export type RevocationStatus =
  | 'pending'
  | 'ok'
  | 'unreachable'
  | 'revoked'
  | 'unpinned'

const REVOKED_ROOTS_PATH = '/.well-known/dpp-revoked-roots.json'
const DEFAULT_HOST = 'https://transpareo.com'

export const revocationStatus = signal<RevocationStatus>('pending')

// The number of the latest check. A check settles the status,
// and logs what it found, only while it is the latest, so one
// the element before started cannot judge the pins of the
// element after it.
let latestCheck = 0

// What a check found: the status it settles and, when the
// console should hear of it, why.
interface Finding {
  readonly status: RevocationStatus
  readonly warning?: string
}

// Called from the setup() of each element that takes the
// page, once its pins are read, so the fetch races with the
// manifest fetch instead of blocking it. Verdict downstream
// consults revocationStatus() reactively.
export function startRevokedRootsCheck(): void {
  const check = ++latestCheck
  revocationStatus.set('pending')

  const pins = config.pinnedPlatformKeys
  if (!pins || pins.length === 0) {
    revocationStatus.set('unpinned')
    return
  }

  // An empty attribute switches the check off.
  const url = config.revokedRootsUrl ?? defaultUrl()
  if (!url) {
    revocationStatus.set('ok')
    return
  }

  void runCheck(url, pins).then(({ status, warning }) => {
    if (check !== latestCheck) return
    if (warning) console.warn(`[revoked-roots] ${warning}`)
    revocationStatus.set(status)
  })
}

// The list at its well-known path on the asset host the page
// names, else on transpareo.com: a page without `asset-host`
// reads the list where it always has.
function defaultUrl(): string {
  const base = config.assetHost ? assetBase() : undefined
  return new URL(REVOKED_ROOTS_PATH, base ?? DEFAULT_HOST).toString()
}

// The pins judged against the list at `url`. Logs nothing:
// the caller does, once it knows the check is the latest.
async function runCheck(
  url: string, pins: ReadonlyArray<string>,
): Promise<Finding> {
  let pinFps: Set<string>
  try {
    pinFps = new Set(
      await Promise.all(pins.map(fingerprintOfMultikey)),
    )
  } catch (err) {
    const warning = `cannot fingerprint pinned key: ${describeError(err)}`
    return { status: 'unreachable', warning }
  }

  let doc: unknown
  try {
    doc = await fetchRevokedRoots(url)
  } catch (err) {
    const warning = `${url} unreachable: ${describeError(err)}`
    return { status: 'unreachable', warning }
  }

  // A list of another shape judges the pins no more than one
  // that will not load.
  const listed = listedFingerprints(doc)
  if (!listed) {
    const warning = `${url} serves no revocation list`
    return { status: 'unreachable', warning }
  }

  const fp = listed.find((f) => pinFps.has(f))
  if (!fp) return { status: 'ok' }
  const warning = `a pinned platform key is revoked (${fp}); `
    + 'all verification verdicts will be forced to unauthenticated'
  return { status: 'revoked', warning }
}

// The fingerprints a list names, normalized, or null when the
// document is no list: an object whose `revokedRoots`, when
// present, is an array of objects whose `fingerprint`, when
// present, is a string. An entry naming no fingerprint names
// no key.
function listedFingerprints(doc: unknown): string[] | null {
  if (!isRecord(doc)) return null
  const entries = doc.revokedRoots ?? []
  if (!Array.isArray(entries)) return null

  const listed: string[] = []
  for (const entry of entries) {
    if (!isRecord(entry)) return null
    const fp = entry.fingerprint ?? ''
    if (typeof fp !== 'string') return null
    if (fp) listed.push(normalizeFingerprint(fp))
  }
  return listed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 'unreachable' fails closed on pinned builds, so a
// transient blip on this one auxiliary fetch must not brick
// the page: retry once after a short delay before settling.
// Deployments that can't rely on the endpoint disable the
// check via `revoked-roots-src=""` instead.
const RETRY_DELAY_MS = 2000
const FETCH_TIMEOUT_MS = 15_000

async function fetchRevokedRoots(url: string): Promise<unknown> {
  try {
    return await fetchOnce(url)
  } catch {
    await delay(RETRY_DELAY_MS)
    return fetchOnce(url)
  }
}

async function fetchOnce(url: string): Promise<unknown> {
  // 'no-cache' revalidates on every boot: a revocation is
  // exactly the artefact that must not be served stale out
  // of the HTTP cache.
  const res = await fetch(url, {
    credentials: 'omit',
    cache: 'no-cache',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Hex sha256 of the decoded multikey bytes. Multikey
// for Ed25519 is `z` + Base58Btc(0xED01 prefix + 32
// raw key) = 34 bytes; both sides hash the full 34
// bytes so the fingerprint is canonical regardless of
// how PEM/DER wraps the same key downstream.
async function fingerprintOfMultikey(multibase: string): Promise<string> {
  const bytes = decodeMultibaseBase58(multibase)
  const digest = await crypto.subtle.digest('SHA-256', asBuffer(bytes))
  return hex(new Uint8Array(digest))
}

// A feed ships entries like {"fingerprint":
// "sha256:abc123..."}; older or fork-specific feeds
// may omit the algorithm prefix. We accept either,
// lower-case the hex, and drop leading whitespace.
export function normalizeFingerprint(raw: string): string {
  const trimmed = raw.trim().toLowerCase()
  return trimmed.startsWith('sha256:')
    ? trimmed.slice('sha256:'.length)
    : trimmed
}

function asBuffer(u: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u.byteLength)
  new Uint8Array(out).set(u)
  return out
}

function hex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}
