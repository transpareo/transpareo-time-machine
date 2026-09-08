/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Judging a version walks the chain back to v1, one prior
 * per link. The priors are all named in the manifest, so
 * the reads start together the moment judging begins and
 * the walk joins them, rather than paying one round trip
 * per link. Each prior is read once: the walk must not
 * repeat a fetch the prefetch already started.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/crypto/dispatch', () => ({
  verifySnapshotAnySuite: vi.fn(),
}))

vi.mock('@/crypto/verify', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/crypto/verify')>(),
  verifyManifestSignature: vi.fn(),
}))

import { verifySnapshotAnySuite } from '@/crypto/dispatch'
import {
  hexHashOfSnapshotBody, verifyManifestSignature,
} from '@/crypto/verify'
import type { VerificationResult } from '@/crypto/verify'
import type { SignedSnapshot } from '@/archive'
import * as host from '@/host'
import { ensureVersionLoaded, resetVerifyCaches } from '@/actions'
import { versionStates } from '@/state'

const MANIFEST_URL = 'https://cdn.test/d/manifest.json'

const AUTHENTIC: VerificationResult = {
  entries: [], verdict: 'authentic', verifiedAuthorityCount: 2,
  totalEntryCount: 2, verifiedEntryCount: 2, mode: 'default',
}

type Body = Record<string, unknown>

function hashOf(body: Body): Promise<string> {
  return hexHashOfSnapshotBody(body as unknown as SignedSnapshot)
}

// A four-version chain whose priorVersionHash links and
// manifest claims all hold, so the walk runs to v1.
async function chainOf(): Promise<{ manifest: unknown, bodies: Body[] }> {
  const bodies: Body[] = []
  const versions: unknown[] = []
  let priorHash: string | undefined
  for (let n = 1; n <= 4; n++) {
    const body: Body = {
      version: n, proof: [], publishedAt: '2026-01-01T00:00:00Z',
      passportAlias: `v${n}`,
      ...(priorHash ? { priorVersionHash: priorHash } : {}),
    }
    priorHash = await hashOf(body)
    bodies.push(body)
    versions.push({
      number: n, url: `/d/v/${n}.json`, publishedAt: null,
      reason: 'created', sizeBytes: 0, hashValue: priorHash,
    })
  }
  const manifest = {
    '@type': 'DppManifest', code: 'dpp-demo', currentVersion: 4,
    versions, epcisUrl: '/d/epcis.json',
  }
  return { manifest, bodies }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

// Snapshot reads are held until the test releases them, so
// the order in which they were asked for is observable.
function stubFetch(
  manifest: unknown, bodies: Body[],
): { calls: string[], priorities: string[], release: () => void } {
  const calls: string[] = []
  const priorities: string[] = []
  let release!: () => void
  const held = new Promise<void>((r) => { release = r })
  vi.stubGlobal('fetch', async (
    input: string | URL, init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push(url)
    priorities.push(init?.priority ?? 'auto')
    if (url.includes('/d/manifest.json')) return json(manifest)
    if (url.includes('/d/epcis.json')) return json({ epcisBody: {} })
    const n = Number(url.match(/\/d\/v\/(\d+)\.json/)?.[1])
    if (n === 4) return json(bodies[3])
    await held
    return json(bodies[n - 1])
  })
  return { calls, priorities, release }
}

const isSnapshot = (u: string): boolean => /\/d\/v\/\d+\.json/.test(u)
const snapshotCalls = (calls: string[]): string[] => calls.filter(isSnapshot)

beforeEach(() => {
  vi.stubGlobal('window', { location: { href: 'https://page.test/' } })
  versionStates.set({})
  resetVerifyCaches()
  vi.mocked(verifySnapshotAnySuite).mockResolvedValue(AUTHENTIC)
  vi.mocked(verifyManifestSignature).mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(verifySnapshotAnySuite).mockReset()
  vi.mocked(verifyManifestSignature).mockReset()
})

describe('chain prefetch', () => {
  it('asks for every prior at once and reads each once', async () => {
    const { manifest, bodies } = await chainOf()
    const { calls, priorities, release } = stubFetch(manifest, bodies)
    await host.bootFrom(MANIFEST_URL)

    ensureVersionLoaded(4)

    // Nothing has come back yet, and all three priors are
    // already on the wire.
    await vi.waitFor(() => {
      expect(snapshotCalls(calls).length).toBe(4)
    })
    expect(snapshotCalls(calls)).toEqual([
      'https://cdn.test/d/v/4.json',
      'https://cdn.test/d/v/3.json',
      'https://cdn.test/d/v/2.json',
      'https://cdn.test/d/v/1.json',
    ])

    // The head is what the page paints; the priors only feed
    // the chip, and yield to the image and keys on the wire.
    const byVersion = calls.map((u, i) => [u, priorities[i]] as const)
      .filter(([u]) => isSnapshot(u))
      .map(([u, p]) => `${u.slice(-6)} ${p}`)
    expect(byVersion).toEqual([
      '4.json auto', '3.json low', '2.json low', '1.json low',
    ])

    release()
    await vi.waitFor(() => {
      expect(versionStates.peek()[4]?.status).toBe('verified')
    })

    // The walk joined the prefetch: no prior was read twice.
    expect(snapshotCalls(calls).length).toBe(4)
  })
})
