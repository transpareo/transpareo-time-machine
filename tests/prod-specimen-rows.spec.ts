// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The proof modal against the real, independently issued
 * ecdsa-sd-2023 snapshot the crypto suite verifies elsewhere
 * (ecdsa-sd-prod.spec.ts), rendered the way the SPA renders
 * it: credentialSubject unwrapped, both derived proofs
 * verified.
 *
 * This snapshot is why attribution cannot rest on declared
 * DIDs alone. Its platform counter-signature names
 * `did:web:transpareo.com`, which the passport declares, but
 * the issuer signs with a key under `did:web:dpp.acme-corp.com`
 * while declaring `did:web:acme.002.fsn.transpareo.com` for
 * itself. Matching DIDs only, the Issuer column of a fully
 * verified production version stayed a dash and its proof row
 * came out nameless, below the platform's.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as host from '@/host'
import { toRenderModel } from '@/host'
import {
  buildVersionRow, buildChainSection,
} from '@/components/dpp-verification-modal'
import type {
  DppManifest, SignedSnapshot, VersionState,
} from '@/archive'
import type { ProofEntryResult } from '@/crypto/verify'

interface Specimen {
  readonly view: SignedSnapshot & {
    readonly proof: ReadonlyArray<{ readonly verificationMethod: string }>
  }
}

const SPECIMEN = JSON.parse(readFileSync(
  join(process.cwd(), 'tests/fixtures/ecdsa-sd-prod-specimen.json'), 'utf8',
)) as Specimen

const VERSION = 3
const MANIFEST = { code: 'abc12345', currentVersion: VERSION } as
  unknown as DppManifest

// Both derived proofs, verified, keyed on their own P-256
// keys - the state ensureVersionLoaded stores once the
// dispatch has run.
function verifiedState(): VersionState {
  const entries = SPECIMEN.view.proof.map((p, index): ProofEntryResult => ({
    index,
    verificationMethod: p.verificationMethod,
    status: 'verified',
    proofValue: 'u2V0B',
    keyMultibase: `zKey${index}`,
    pinned: false,
    issuerPinned: false,
  }))
  return {
    status: 'verified',
    result: { entries, cryptosuite: 'ecdsa-sd-2023' },
    chain: { status: 'ok' },
  } as unknown as VersionState
}

function cells(row: HTMLTableRowElement): string[] {
  return [...row.querySelectorAll('td.col-authority')].map((td) => {
    const orb = td.querySelector('.orb')
    if (orb) return orb.classList.contains('orb-verified') ? 'ok' : 'failed'
    return td.textContent ?? ''
  })
}

beforeEach(() => {
  host.currentVersion.set(VERSION)
  host.snapshots.set({ [VERSION]: toRenderModel(SPECIMEN.view) })
})

describe('production ecdsa-sd specimen in the proof modal', () => {
  it('badges the issuer and the platform of a verified version', () => {
    expect(cells(buildVersionRow(VERSION, verifiedState(), MANIFEST))).
      toEqual(['ok', 'ok', 'ok'])
  })

  it('names both proof rows, issuer first', () => {
    const names = [...buildChainSection(verifiedState())
      .querySelectorAll('.proof-authority-name')].map((n) => n.textContent)
    expect(names).toEqual(['Issuer', 'Transpareo'])
  })

  it('reads the platform DID the passport declares', () => {
    // Guards the premise: the platform is identified outright,
    // which is what lets the issuer's group be named at all.
    const methods = SPECIMEN.view.proof.map((p) => p.verificationMethod)
    expect(methods[1]).toBe('did:web:transpareo.com#key-1')
    expect(host.snapshots()[VERSION]?.platform.did).
      toBe('did:web:transpareo.com')
    expect(host.snapshots()[VERSION]?.issuer.did).
      not.toBe(methods[0]?.split('#')[0])
  })
})
