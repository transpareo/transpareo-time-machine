/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Content-continuity chain walk for the standalone
 * <dpp-verifier> widget. Same contract as the SPA's
 * verifyChainLink (actions.ts): walk backwards from the
 * current version to v1, recomputing each prior snapshot's
 * body hash from its bytes and cross-checking it against
 * BOTH the manifest's hashValue entry and the next
 * snapshot's priorVersionHash claim, so a re-emitted
 * manifest with matching forged hashes still fails.
 * Restated standalone (fetcher injected by the caller)
 * so the widget doesn't pull in the SPA's host/state
 * stack and the walk stays unit-testable.
 */

import type { DppManifest, SignedSnapshot } from '@/archive'
import { hexHashOfSnapshotBody } from '@/crypto/verify'

export interface ChainCheckResult {
  readonly status: 'ok' | 'broken' | 'not-applicable'
  readonly reason?: string
}

export type SnapshotFetcher = (url: string) => Promise<SignedSnapshot>

export async function verifyChainFromHead(
  manifest: DppManifest,
  manifestUrl: string,
  head: SignedSnapshot,
  fetchSnapshot: SnapshotFetcher,
): Promise<ChainCheckResult> {
  let n = manifest.currentVersion
  let snapshot = head
  if (n <= 1) return { status: 'not-applicable' }

  while (n > 1) {
    const priorNumber = n - 1
    const priorEntry = manifest.versions.find(
      (v) => v.number === priorNumber,
    )
    if (!priorEntry) {
      return broken(`manifest has no entry for v${priorNumber}`)
    }
    const claim = priorHashOf(snapshot)
    if (!claim) {
      return broken(`v${n} has no priorVersionHash field`)
    }
    if (claim !== priorEntry.hashValue) {
      return broken(`v${n}'s priorVersionHash does not match the manifest`)
    }

    const prior = await fetchSnapshot(
      new URL(priorEntry.url, manifestUrl).toString(),
    )
    const computed = await hexHashOfSnapshotBody(prior)
    if (computed !== claim) {
      return broken(
        `v${priorNumber} body does not hash to the claimed value`,
      )
    }
    snapshot = prior
    n = priorNumber
  }
  return { status: 'ok' }
}

function broken(reason: string): ChainCheckResult {
  return { status: 'broken', reason }
}

function priorHashOf(snapshot: SignedSnapshot): string | undefined {
  const v = (snapshot as { priorVersionHash?: unknown }).priorVersionHash
  return typeof v === 'string' ? v : undefined
}
