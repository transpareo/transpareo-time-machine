// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A row of the per-version verdicts table. Each of its three
 * check columns says one of four things, and the visitor has
 * to be able to tell them apart: a passed check is the green
 * orb, a FAILED check is the red X, a check that has not run
 * is the pending ellipsis, and a check that cannot exist for
 * this row (v1 has no prior version to chain to, a suite that
 * carries no proof for that authority) is the dash. The bug
 * this guards against: an unverified version rendering the
 * same dash as a genuinely not-applicable cell, which reads
 * as "nothing to check here" when the truth is "not checked
 * yet".
 *
 * Also pins the authority mapping across both cryptosuites:
 * an eddsa-jcs proof set names its keys by path, an ecdsa-sd
 * pair names a did:web method per authority, and both have to
 * land in the Issuer and platform columns.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as host from '@/host'
import { buildVersionRow } from '@/components/dpp-verification-modal'
import type { DppSnapshot } from '@/types'
import type { DppManifest, VersionState } from '@/archive'
import type { ProofEntryResult } from '@/crypto/verify'
import type { ChainStatusResult } from '@/actions'

const ISSUER_DID = 'did:web:acme.example'
const PLATFORM_DID = 'did:web:platform.example'
const SD_ISSUER = `${ISSUER_DID}#key-2`
const SD_PLATFORM = `${PLATFORM_DID}#key-3`
const JCS_ISSUER = 'https://cdn.example/p/keys/issuer.json'
const JCS_PLATFORM = 'https://cdn.example/p/keys/platform.json'

const MANIFEST = {
  code: 'demo-2026-t001',
  currentVersion: 2,
  versions: [{ number: 1 }, { number: 2 }]
} as unknown as DppManifest

function entry(method: string, verified: boolean): ProofEntryResult {
  return {
    index: 0,
    verificationMethod: method,
    status: verified ? 'verified' : 'invalid',
    proofValue: 'z1',
    pinned: false,
    issuerPinned: false
  }
}

function state(
  entries: ProofEntryResult[], chain: ChainStatusResult,
): VersionState {
  const failed = entries.some((e) => e.status !== 'verified')
    || chain.status === 'broken'
  const result = { entries }
  if (!failed) {
    return { status: 'verified', result, chain } as unknown as VersionState
  }
  return failedState(entries, chain)
}

function failedState(
  entries: ProofEntryResult[], chain: ChainStatusResult,
): VersionState {
  return {
    status: 'failed', result: { entries }, chain,
    reason: 'a proof did not verify'
  } as unknown as VersionState
}

// The three check columns of a row, in table order: issuer,
// platform, chain. Read as either the orb's verdict class or
// the neutral cell's text.
function cells(row: HTMLTableRowElement): string[] {
  return [...row.querySelectorAll('td.col-authority')].map((td) => {
    const orb = td.querySelector('.orb')
    if (orb) return orb.classList.contains('orb-verified') ? 'ok' : 'failed'
    return td.textContent ?? ''
  })
}

beforeEach(() => {
  host.currentVersion.set(2)
  host.snapshots.set({
    2: {
      issuer: { name: 'Acme', did: ISSUER_DID },
      platform: { name: 'Transpareo', did: PLATFORM_DID }
    } as unknown as DppSnapshot
  })
})

describe('buildVersionRow: authority columns', () => {
  it('badges both columns of an ecdsa-sd pair by their DIDs', () => {
    const s = state(
      [entry(SD_ISSUER, true), entry(SD_PLATFORM, true)],
      { status: 'ok' },
    )
    expect(cells(buildVersionRow(2, s, MANIFEST))).
      toEqual(['ok', 'ok', 'ok'])
  })

  it('badges both columns of an eddsa-jcs set by their paths', () => {
    const s = state(
      [entry(JCS_ISSUER, true), entry(JCS_PLATFORM, true)],
      { status: 'ok' },
    )
    expect(cells(buildVersionRow(2, s, MANIFEST))).
      toEqual(['ok', 'ok', 'ok'])
  })

  it('renders the X for the authority whose proof failed', () => {
    const s = state(
      [entry(SD_ISSUER, true), entry(SD_PLATFORM, false)],
      { status: 'ok' },
    )
    expect(cells(buildVersionRow(2, s, MANIFEST))).
      toEqual(['ok', 'failed', 'ok'])
  })

  it('renders the X for a broken chain link', () => {
    const s = state(
      [entry(SD_ISSUER, true), entry(SD_PLATFORM, true)],
      { status: 'broken', reason: 'priorVersionHash does not match' },
    )
    expect(cells(buildVersionRow(2, s, MANIFEST))).
      toEqual(['ok', 'ok', 'failed'])
  })

  it('dashes an authority the snapshot carries no proof for', () => {
    const s = state([entry(SD_ISSUER, true)], { status: 'ok' })
    expect(cells(buildVersionRow(2, s, MANIFEST))).
      toEqual(['ok', '-', 'ok'])
  })

  it('keeps that dash when the row failed on another check', () => {
    // An issuer-only credential whose chain link broke: the
    // platform still has nothing to badge, and the dash says
    // so without implying the missing proof is the failure.
    const s = failedState(
      [entry(SD_ISSUER, true)],
      { status: 'broken', reason: 'priorVersionHash does not match' },
    )
    expect(cells(buildVersionRow(2, s, MANIFEST))).
      toEqual(['ok', '-', 'failed'])
  })

  it('renders the X in both columns for proofs it cannot place', () => {
    // Two keys, neither of them either declared authority's,
    // on a row that failed: the check ran and produced no
    // verdict for either party, which is not "does not apply".
    const s = failedState(
      [
        entry('did:web:stranger.example#k1', false),
        entry('did:web:nobody.example#k2', false)
      ],
      { status: 'ok' },
    )
    expect(cells(buildVersionRow(2, s, MANIFEST))).
      toEqual(['failed', 'failed', 'ok'])
  })

  it('renders the X in both columns when the verify produced none', () => {
    // The catch path in ensureVersionLoaded, a proofless
    // snapshot and an unreadable cryptosuite all store a
    // failed state with no entries. The check ran and failed,
    // so it must not read as "nothing to check here".
    const s = failedState([], { status: 'unknown' })
    expect(cells(buildVersionRow(2, s, MANIFEST))).
      toEqual(['failed', 'failed', '…'])
  })
})

describe('buildVersionRow: unrun vs not applicable', () => {
  it('marks every column of an unverified version as unrun', () => {
    expect(cells(buildVersionRow(2, undefined, MANIFEST))).
      toEqual(['…', '…', '…'])
  })

  it('marks every column of a version still verifying as unrun', () => {
    expect(cells(buildVersionRow(2, { status: 'pending' }, MANIFEST))).
      toEqual(['…', '…', '…'])
  })

  it('dashes v1 chain cell, which has no prior version', () => {
    const s = state(
      [entry(SD_ISSUER, true), entry(SD_PLATFORM, true)],
      { status: 'not-applicable' },
    )
    expect(cells(buildVersionRow(1, s, MANIFEST))).
      toEqual(['ok', 'ok', '-'])
  })

  it('marks a chain walk that could not complete as unrun', () => {
    const s = state(
      [entry(SD_ISSUER, true), entry(SD_PLATFORM, true)],
      { status: 'unknown', reason: 'prior snapshot not retrievable' },
    )
    expect(cells(buildVersionRow(2, s, MANIFEST))).
      toEqual(['ok', 'ok', '…'])
  })

  it('keeps the unrun marker distinct from the not-applicable dash', () => {
    const unrun = buildVersionRow(2, undefined, MANIFEST)
    const notApplicable = buildVersionRow(1, state(
      [entry(SD_ISSUER, true), entry(SD_PLATFORM, true)],
      { status: 'not-applicable' },
    ), MANIFEST)
    const chainCell = (row: HTMLTableRowElement): Element =>
      [...row.querySelectorAll('td.col-authority')][2].firstElementChild!
    expect(chainCell(unrun).className).toBe('col-authority-unrun')
    expect(chainCell(notApplicable).className).toBe('col-authority-na')
  })
})
