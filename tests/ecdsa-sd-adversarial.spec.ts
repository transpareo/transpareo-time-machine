/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Adversarial coverage for src/crypto/ecdsa-sd.ts: take a
 * valid derived proof and tamper one component of the
 * decoded proofValue at a time, re-encode, and require the
 * verifier to reject. These target the security-critical
 * invariants the happy-path tests do not exercise:
 *   - the proof-scoped public key is bound into the base
 *     signature, so swapping it cannot go unnoticed;
 *   - mandatoryIndexes are range- and duplicate-checked;
 *   - the signature count must match the disclosed
 *     non-mandatory statements.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { verifyDerivedProof, parseDerivedProofValue } from '../src/crypto/ecdsa-sd';
import {
  createSampleSigner, encodeDerivedProofValue, type SampleSigner,
} from './helpers/sd-signer';

let signer: SampleSigner;

beforeAll(async () => {
  signer = await createSampleSigner();
});

interface Components {
  baseSignature: Uint8Array;
  publicKey: Uint8Array;
  signatures: Uint8Array[];
  labelMap: Array<[number, Uint8Array]>;
  mandatoryIndexes: number[];
}

// Decode a document's proofValue into mutable components,
// let the caller tamper them, then re-encode and reattach.
function tamper(
  doc: Record<string, unknown>, mutate: (c: Components) => void,
): Record<string, unknown> {
  const proof = doc.proof as Record<string, unknown>;
  const parsed = parseDerivedProofValue(proof.proofValue as string);
  const components: Components = {
    baseSignature: Uint8Array.from(parsed.baseSignature),
    publicKey: Uint8Array.from(parsed.publicKey),
    signatures: parsed.signatures.map((s) => Uint8Array.from(s)),
    labelMap: [...parsed.labelMap.entries()]
      .map(([k, v]) => [k, Uint8Array.from(v)] as [number, Uint8Array]),
    mandatoryIndexes: [...parsed.mandatoryIndexes],
  };
  mutate(components);
  return {
    ...doc,
    proof: { ...proof, proofValue: encodeDerivedProofValue(components) },
  };
}

describe('verifyDerivedProof: proof-scoped key binding', () => {
  it('rejects a swapped proof-scoped public key', async () => {
    // The proof-scoped key is part of the base signature's
    // signed data, so altering it must break the base
    // signature against the issuer key.
    const doc = await signer.makeDerived(['recycled']);
    const tampered = tamper(doc, (c) => { c.publicKey[2] ^= 0xff; });
    const result = await verifyDerivedProof(tampered, signer.issuer.multikey);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/base signature/);
  });
});

describe('verifyDerivedProof: mandatoryIndexes validation', () => {
  it('rejects an out-of-range mandatory index', async () => {
    const doc = await signer.makeDerived(['recycled']);
    const tampered = tamper(doc, (c) => { c.mandatoryIndexes = [999]; });
    const result = await verifyDerivedProof(tampered, signer.issuer.multikey);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/out of range/);
  });

  it('rejects a duplicate mandatory index', async () => {
    const doc = await signer.makeDerived(['recycled']);
    const tampered = tamper(doc, (c) => { c.mandatoryIndexes = [0, 0]; });
    const result = await verifyDerivedProof(tampered, signer.issuer.multikey);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/duplicate mandatory index/);
  });
});

describe('verifyDerivedProof: signature-count validation', () => {
  it('rejects a dropped per-statement signature', async () => {
    const doc = await signer.makeDerived(['recycled']);
    const tampered = tamper(doc, (c) => { c.signatures.pop(); });
    const result = await verifyDerivedProof(tampered, signer.issuer.multikey);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/does not match/);
  });

  it('rejects an extra per-statement signature', async () => {
    const doc = await signer.makeDerived(['recycled']);
    const tampered = tamper(doc, (c) => {
      c.signatures.push(new Uint8Array(64));
    });
    const result = await verifyDerivedProof(tampered, signer.issuer.multikey);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/does not match/);
  });
});
