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
 *      https://transpareo.com/.well-known/dpp-revoked-roots.json).
 *   3. Each entry's fingerprint is compared against
 *      SHA-256(decoded multikey bytes) of every
 *      pinned key. The wire format prefixes the hex
 *      with `sha256:` per the backend's well_known
 *      controller; we strip it before comparing.
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
 *      blocking exactly this fetch.
 *   6. No pin in config -> revocationStatus =
 *      'unpinned'; the fetch is skipped because there
 *      is nothing to compare against.
 *
 * Forks: set `revokedRootsUrl: ''` to disable the
 * fetch (e.g. dev / offline kiosks), or point it at
 * the fork's own well-known endpoint.
 */

import { signal } from '@/reactive/signals'
import { config } from '@/config'
import { decodeMultibaseBase58 } from '@/crypto/multibase'

export type RevocationStatus =
  | 'pending'
  | 'ok'
  | 'unreachable'
  | 'revoked'
  | 'unpinned'

const DEFAULT_URL =
  'https://transpareo.com/.well-known/dpp-revoked-roots.json'

export const revocationStatus = signal<RevocationStatus>('pending')

interface RevokedRootsDoc {
  readonly revokedRoots?: ReadonlyArray<{
    readonly fingerprint?: string
  }>
}

let started = false

// Module-level kick-off. Called from bootstrap-spa so
// the fetch races with the manifest fetch instead of
// blocking it. Verdict downstream consults
// revocationStatus() reactively.
export function startRevokedRootsCheck(): void {
  if (started) return
  started = true

  const url = config.revokedRootsUrl ?? DEFAULT_URL
  const pins = config.pinnedPlatformKeys
  if (!pins || pins.length === 0) {
    revocationStatus.set('unpinned')
    return
  }
  if (!url) {
    revocationStatus.set('ok')
    return
  }

  void runCheck(url, pins)
}

async function runCheck(
  url: string, pins: ReadonlyArray<string>,
): Promise<void> {
  let pinFps: Set<string>
  try {
    pinFps = new Set(
      await Promise.all(pins.map(fingerprintOfMultikey)),
    )
  } catch (err) {
    console.warn('[revoked-roots] cannot fingerprint pinned key:', err)
    revocationStatus.set('unreachable')
    return
  }

  let doc: RevokedRootsDoc
  try {
    doc = await fetchRevokedRoots(url)
  } catch (err) {
    console.warn(`[revoked-roots] ${url} unreachable:`, err)
    revocationStatus.set('unreachable')
    return
  }

  const entries = doc.revokedRoots ?? []
  for (const entry of entries) {
    if (!entry.fingerprint) continue
    const fp = normalizeFingerprint(entry.fingerprint)
    if (pinFps.has(fp)) {
      console.warn(
        `[revoked-roots] a pinned platform key is revoked (${fp}); `
        + 'all verification verdicts will be forced to unauthenticated',
      )
      revocationStatus.set('revoked')
      return
    }
  }
  revocationStatus.set('ok')
}

// 'unreachable' fails closed on pinned builds, so a
// transient blip on this one auxiliary fetch must not brick
// the page: retry once after a short delay before settling.
// Deployments that can't rely on the endpoint disable the
// check via `revoked-roots-src=""` instead.
const RETRY_DELAY_MS = 2000
const FETCH_TIMEOUT_MS = 15_000

async function fetchRevokedRoots(url: string): Promise<RevokedRootsDoc> {
  try {
    return await fetchOnce(url)
  } catch {
    await delay(RETRY_DELAY_MS)
    return fetchOnce(url)
  }
}

async function fetchOnce(url: string): Promise<RevokedRootsDoc> {
  // 'no-cache' revalidates on every boot: a revocation is
  // exactly the artefact that must not be served stale out
  // of the HTTP cache.
  const res = await fetch(url, {
    credentials: 'omit',
    cache: 'no-cache',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.json() as RevokedRootsDoc
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

// The backend ships entries like {"fingerprint":
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
