/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Round-trip guard for the ecdsa-sd version chain: the seed
 * stamps a manifest's hashValue and each snapshot's
 * priorVersionHash with hexChainHashOfSnapshot, and the chain
 * walkers (this widget one, plus the SPA's verifyChainLink)
 * must recompute the same value. The bug this guards against:
 * hashing an ecdsa-sd Verifiable Credential with the flat JCS
 * body hash (hexHashOfSnapshotBody) instead of its RDFC
 * statements hash, which silently breaks the chain on every
 * validly signed ecdsa-sd version.
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEcdsaSdIssuer } from '../scripts/seed/ecdsa-sd-signing'
import {
  hexChainHashOfSnapshot, hexHashOfSnapshotBody,
} from '../src/crypto/chain-hash'
import { verifyChainFromHead } from '../src/verifier-chain'
import type { DppManifest, SignedSnapshot } from '../src/archive'

const ISSUER_DID = 'did:web:acme.example'
const PLATFORM_DID = 'did:web:platform.example'

function bodyFor(
  version: number, priorVersionHash?: string,
): Record<string, unknown> {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    '@type': 'dpp:DigitalProductPassport',
    '@id': 'https://acme.example/dpp/abc12345',
    passportAlias: 'abc12345',
    version,
    ...(priorVersionHash ? { priorVersionHash } : {}),
    product: {
      '@type': 'Product',
      name: 'Pulse 2000',
      properties: [
        {
          '@type': 'PropertyValue', propertyID: 'capacity',
          name: 'Capacity', value: `${version}.0`,
        },
      ],
    },
  }
}

function manifestWith(
  hash1: string, hash2: string,
): DppManifest {
  return {
    currentVersion: 2,
    versions: [
      { number: 1, url: 'v/1.json', hashValue: hash1 },
      { number: 2, url: 'v/2.json', hashValue: hash2 },
    ],
  } as unknown as DppManifest
}

describe('ecdsa-sd version chain round-trip', () => {
  it('verifies a chain hashed the way the seed emits it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-chain-'))
    const issuer = await buildEcdsaSdIssuer(
      dir, 'acme', 'abc12345', '2026-05-01T12:00:00Z',
      ISSUER_DID, PLATFORM_DID,
    )
    const v1 = await issuer.issue(bodyFor(1))
    const chain1 = await hexChainHashOfSnapshot(v1)
    const v2 = await issuer.issue(bodyFor(2, chain1))
    const chain2 = await hexChainHashOfSnapshot(v2)

    // The VC chain hash is the RDFC statements hash, which is
    // NOT the flat JCS body hash - the whole point of the fix.
    expect(chain1).not.toBe(await hexHashOfSnapshotBody(v1))

    const fetchSnapshot = (url: string): Promise<SignedSnapshot> => {
      if (url.endsWith('/v/1.json')) return Promise.resolve(v1 as SignedSnapshot)
      throw new Error(`unexpected fetch ${url}`)
    }

    const ok = await verifyChainFromHead(
      manifestWith(chain1, chain2),
      'https://acme.example/dpp/abc12345/manifest.json',
      v2 as SignedSnapshot,
      fetchSnapshot,
    )
    expect(ok.status).toBe('ok')
  })

  it('rejects a chain hashed the old (JCS body) way', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-chain-'))
    const issuer = await buildEcdsaSdIssuer(
      dir, 'acme', 'abc12345', '2026-05-01T12:00:00Z',
      ISSUER_DID, PLATFORM_DID,
    )
    const v1 = await issuer.issue(bodyFor(1))
    // Emit v2's priorVersionHash + the manifest with the flat
    // JCS body hash, as the pre-fix seed did.
    const jcs1 = await hexHashOfSnapshotBody(v1)
    const v2 = await issuer.issue(bodyFor(2, jcs1))
    const jcs2 = await hexHashOfSnapshotBody(v2)

    const fetchSnapshot = (_url: string): Promise<SignedSnapshot> =>
      Promise.resolve(v1 as SignedSnapshot)

    const result = await verifyChainFromHead(
      manifestWith(jcs1, jcs2),
      'https://acme.example/dpp/abc12345/manifest.json',
      v2 as SignedSnapshot,
      fetchSnapshot,
    )
    expect(result.status).toBe('broken')
  })
})
