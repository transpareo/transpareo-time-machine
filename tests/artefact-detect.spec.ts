/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The shared artefact detector: one classification rule
 * for the SPA host boot and the standalone verifier
 * widget, so a URL the renderer accepts is never rejected
 * by the verifier as the wrong shape.
 */
import { describe, it, expect } from 'vitest'
import { detectArtefact, snapshotBody } from '@/artefact-detect'

const PROOF = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  proofValue: 'z123'
}

describe('detectArtefact', () => {
  it('detects a tagged manifest', () => {
    expect(detectArtefact({ '@type': 'DppManifest' })).toBe('manifest')
  })

  it('detects an untagged manifest by its versions array', () => {
    expect(detectArtefact({ versions: [] })).toBe('manifest')
  })

  it('detects a flat snapshot by its proof array', () => {
    const flat = { version: 3, publishedAt: 'x', proof: [PROOF] }
    expect(detectArtefact(flat)).toBe('snapshot')
  })

  it('detects a VC snapshot by its single proof object', () => {
    const vc = {
      '@type': 'dpp:DigitalProductPassport',
      credentialSubject: { version: 1 },
      proof: PROOF
    }
    expect(detectArtefact(vc)).toBe('snapshot')
  })

  it('classifies a manifest before a snapshot when both match', () => {
    // A manifest carries its own proof; the versions array
    // still names it a manifest.
    expect(detectArtefact({ versions: [], proof: [PROOF] })).toBe('manifest')
  })

  it('rejects JSON that carries nothing signed', () => {
    expect(detectArtefact(null)).toBe('unknown')
    expect(detectArtefact('json string')).toBe('unknown')
    expect(detectArtefact([PROOF])).toBe('unknown')
    expect(detectArtefact({})).toBe('unknown')
    expect(detectArtefact({ version: 1 })).toBe('unknown')
    expect(detectArtefact({ proof: [] })).toBe('unknown')
    expect(detectArtefact({ proof: 'z123' })).toBe('unknown')
  })
})

describe('snapshotBody', () => {
  it('passes a flat snapshot through unchanged', () => {
    const flat = { version: 3, proof: [PROOF] }
    expect(snapshotBody(flat)).toBe(flat)
  })

  it('unwraps a VC to its subject with the proof as array', () => {
    const vc = {
      credentialSubject: { version: 2, publishedAt: 'x' },
      proof: PROOF
    }
    expect(snapshotBody(vc)).
      toEqual({ version: 2, publishedAt: 'x', proof: [PROOF] })
  })

  it('keeps an already-array proof as it is', () => {
    const vc = { credentialSubject: { version: 2 }, proof: [PROOF] }
    expect(snapshotBody(vc).proof).toEqual([PROOF])
  })
})
