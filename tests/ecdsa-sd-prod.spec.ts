/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Verifies real, independently issued ecdsa-sd-2023 snapshots
 * carrying both derived proofs (issuer + platform
 * counter-signature), resolved offline. This is the
 * cross-implementation check: our hand-written canonicalizer
 * and verifier against a separate JSON-LD + RDF
 * canonicalization toolchain.
 *
 * Two shapes: one signed over the VC base + transpareo v1
 * contexts, and one led by the W3C credentials context, whose
 * envelope and proof terms sit in type-scoped contexts.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { verifyDerivedProof } from '../src/crypto/ecdsa-sd'
import { canonicalize } from '../src/crypto/rdfc'
import { DPP_CONTEXTS } from '../src/crypto/dpp-contexts'
import { hexChainHashOfSnapshot } from '../src/crypto/verify'
import type { ProofCarrier } from '../src/crypto/verify'

interface Specimen {
  view: Record<string, unknown> & { proof: unknown[] }
  public_view: unknown
  public_view_hash_hex: string
  issuer_multikeys_b64: string[]
  issuer_nquads: string[]
  contexts?: Record<string, unknown>
  vc_context?: unknown
  transpareo_context?: unknown
}

const BEFORE = 'ecdsa-sd-prod-specimen.json'
const BASE_CONTEXT = 'ecdsa-sd-prod-specimen-base-context.json'

function load(name: string): Specimen {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8')) as Specimen
}

// The older specimen names its two contexts by key, the newer
// one carries every context it names by URL.
function contextsOf(spec: Specimen): Record<string, unknown> {
  if (spec.contexts) return spec.contexts
  return {
    'https://transpareo.com/vocab/vc/v1': spec.vc_context,
    'https://transpareo.com/vocab/transpareo/v1': spec.transpareo_context
  }
}

describe.each([
  ['before the base context', BEFORE],
  ['led by the base context', BASE_CONTEXT]
])('ecdsa-sd: real production specimen %s', (_shape, file) => {
  it('verifies both independently issued derived proofs', async () => {
    const spec = load(file)
    const keys = spec.issuer_multikeys_b64
    const proofs = spec.view.proof
    expect(proofs.length).toBe(keys.length)
    expect(proofs.length).toBeGreaterThan(1)
    for (let i = 0; i < proofs.length; i++) {
      const key = new Uint8Array(Buffer.from(keys[i], 'base64'))
      const result = await verifyDerivedProof(
        { ...spec.view, proof: proofs[i] }, key
      )
      expect(result.reason ?? '').toBe('')
      expect(result.verified).toBe(true)
    }
  })

  // The specimen ships the issuing implementation's own
  // canonical statements beside the document, so the two
  // toolchains can be compared statement by statement rather
  // than only through a signature. A proof failure says
  // "these bytes are not those bytes"; this says which
  // statement moved, which is the difference between a
  // morning of bisecting and a one-line read. Canonicalized
  // against the contexts the specimen carries, so a failure
  // means the algorithms disagree and never that our bundled
  // copy of a context drifted.
  it('agrees with the issuer statement for statement', async () => {
    const spec = load(file)
    const { proof: _proof, ...unsecured } = spec.view
    const ours = await canonicalize(unsecured, { contexts: contextsOf(spec) })
    expect(ours).toEqual(spec.issuer_nquads)
  })

  // The chain walker recomputes each prior public snapshot's
  // manifest hashValue from its bytes. For an ecdsa-sd
  // snapshot that hash is the SHA-256 over ALL its RDFC
  // canonical statements (equal to the mandatory hash,
  // because the public view reveals exactly the mandatory
  // statements) - never the JCS body hash the flat
  // eddsa-jcs snapshots use.
  it('recomputes the issued chain hash from the public bytes', async () => {
    const spec = load(file)
    const computed = await hexChainHashOfSnapshot(
      spec.public_view as ProofCarrier
    )
    expect(computed).toBe(spec.public_view_hash_hex)
  })
})

// The proof hash and the chain hash read the bundled copies,
// so each must be the document the issuer resolved.
describe('the contexts a credential led by the base context names', () => {
  it('are bundled as the issuer resolved them', () => {
    for (const [url, doc] of Object.entries(load(BASE_CONTEXT).contexts!)) {
      expect(DPP_CONTEXTS[url], url).toEqual(doc)
    }
  })
})
