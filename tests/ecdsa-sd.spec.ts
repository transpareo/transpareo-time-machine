/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * End-to-end verification coverage for src/crypto/ecdsa-sd.ts.
 *
 * The signed data comes from the test-only issuer in
 * ./helpers/sd-signer (WebCrypto P-256 + an inline CBOR
 * encoder), verified through the production path. This
 * exercises proofValue decode, proof-options + document
 * canonicalization, the mandatory / non-mandatory split,
 * the base signature against the issuer key, and each
 * disclosed statement against the proof-scoped key.
 *
 * The canonicalizer is shared between signer and verifier,
 * so a canonicalizer bug is not what this catches:
 * rdfc.spec.ts checks it independently against hand-derived
 * N-Quads, and ecdsa-sd-prod.spec.ts checks byte-for-byte
 * agreement against a real, independently issued proof.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import {
  verifyDerivedProof, parseDerivedProofValue,
} from '../src/crypto/ecdsa-sd';
import { encodeBase64url } from '../src/crypto/base64url';
import { createSampleSigner, generateKey, type SampleSigner } from './helpers/sd-signer';

let signer: SampleSigner;

beforeAll(async () => {
  signer = await createSampleSigner();
});

describe('verifyDerivedProof: authentic derived views', () => {
  it('verifies a full disclosure (both disclosable fields)', async () => {
    const doc = await signer.makeDerived(['recycled', 'hazard']);
    const result = await verifyDerivedProof(doc, signer.issuer.multikey);
    expect(result.verified).toBe(true);
    expect(result.mandatoryCount).toBe(3);
    expect(result.nonMandatoryCount).toBe(2);
  });

  it('verifies a partial (legitimate-interest) view', async () => {
    const doc = await signer.makeDerived(['recycled']);
    const result = await verifyDerivedProof(doc, signer.issuer.multikey);
    expect(result.verified).toBe(true);
    expect(result.nonMandatoryCount).toBe(1);
  });

  it('verifies the public-only view (nothing disclosable revealed)', async () => {
    const doc = await signer.makeDerived([]);
    const result = await verifyDerivedProof(doc, signer.issuer.multikey);
    expect(result.verified).toBe(true);
    expect(result.mandatoryCount).toBe(3);
    expect(result.nonMandatoryCount).toBe(0);
  });
});

describe('verifyDerivedProof: rejects tampering', () => {
  it('rejects an unknown issuer key', async () => {
    const doc = await signer.makeDerived(['recycled']);
    const stranger = await generateKey();
    const result = await verifyDerivedProof(doc, stranger.multikey);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/base signature/);
  });

  it('rejects a corrupted base signature', async () => {
    const doc = await signer.makeDerived(['recycled'], 'base-sig');
    const result = await verifyDerivedProof(doc, signer.issuer.multikey);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/base signature/);
  });

  it('rejects a corrupted per-statement signature', async () => {
    const doc = await signer.makeDerived(['recycled'], 'statement-sig');
    const result = await verifyDerivedProof(doc, signer.issuer.multikey);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/statement 0 does not verify/);
  });

  it('rejects a tampered disclosed value', async () => {
    const doc = await signer.makeDerived(['recycled']);
    doc.recycled = '99%';
    const result = await verifyDerivedProof(doc, signer.issuer.multikey);
    expect(result.verified).toBe(false);
  });

  it('rejects a tampered mandatory value (via the base signature)', async () => {
    const doc = await signer.makeDerived(['recycled']);
    doc.capacity = '9.9 kWh';
    const result = await verifyDerivedProof(doc, signer.issuer.multikey);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/base signature|statement/);
  });
});

// Deliberately malformed CBOR, built locally: these probe
// the parser's structural checks, not the signer.
function bstr(b: Uint8Array): number[] {
  const header = b.length < 24 ? [0x40 | b.length] : [0x58, b.length];
  return [...header, ...b];
}
function derivedTag(components: number[][]): string {
  const array = [0x80 | components.length, ...components.flat()];
  return 'u' + encodeBase64url(Uint8Array.from([0xd9, 0x5d, 0x01, ...array]));
}

describe('parseDerivedProofValue: structural validation', () => {
  it('parses a well-formed derived proofValue', async () => {
    const doc = await signer.makeDerived(['recycled', 'hazard']);
    const proof = doc.proof as { proofValue: string };
    const parsed = parseDerivedProofValue(proof.proofValue);
    expect(parsed.baseSignature.length).toBe(64);
    expect(parsed.signatures.length).toBe(2);
    expect(parsed.mandatoryIndexes.length).toBe(3);
  });

  it('rejects a base-proof tag (0xd95d00) as not derived', () => {
    const proofValue = 'u'
      + encodeBase64url(Uint8Array.from([0xd9, 0x5d, 0x00, 0x80]));
    expect(() => parseDerivedProofValue(proofValue))
      .toThrow(/not a derived proof/);
  });

  it('rejects a component count other than five', () => {
    const proofValue = derivedTag([bstr(new Uint8Array(64))]);
    expect(() => parseDerivedProofValue(proofValue))
      .toThrow(/components, expected 5/);
  });
});
