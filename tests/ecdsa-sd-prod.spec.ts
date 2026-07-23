/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Verifies a real, independently issued ecdsa-sd-2023
 * snapshot carrying both derived proofs (issuer + platform
 * counter-signature) over the VC base + transpareo contexts,
 * resolved offline. This is the cross-implementation check:
 * our hand-written canonicalizer and verifier against a
 * separate JSON-LD + RDF canonicalization toolchain.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyDerivedProof } from '../src/crypto/ecdsa-sd';
import { hexChainHashOfSnapshot } from '../src/crypto/verify';
import type { ProofCarrier } from '../src/crypto/verify';

const SPECIMEN = fileURLToPath(
  new URL('./fixtures/ecdsa-sd-prod-specimen.json', import.meta.url),
);

describe('ecdsa-sd: real production specimen', () => {
  it('verifies both independently issued derived proofs', async () => {
    const spec = JSON.parse(readFileSync(SPECIMEN, 'utf8'));
    const keys = spec.issuer_multikeys_b64 as string[];
    const proofs = spec.view.proof as unknown[];
    expect(proofs.length).toBe(keys.length);
    expect(proofs.length).toBeGreaterThan(1);
    for (let i = 0; i < proofs.length; i++) {
      const key = new Uint8Array(Buffer.from(keys[i], 'base64'));
      const result = await verifyDerivedProof(
        { ...spec.view, proof: proofs[i] }, key,
      );
      expect(result.reason ?? '').toBe('');
      expect(result.verified).toBe(true);
    }
  });

  // The chain walker recomputes each prior public snapshot's
  // manifest hashValue from its bytes. For an ecdsa-sd
  // snapshot that hash is the SHA-256 over ALL its RDFC
  // canonical statements (equal to the backend's mandatory
  // hash, because the public view reveals exactly the
  // mandatory statements) - never the JCS body hash the flat
  // eddsa-jcs snapshots use.
  it('recomputes the backend chain hash from the public view bytes', async () => {
    const spec = JSON.parse(readFileSync(SPECIMEN, 'utf8'));
    const computed = await hexChainHashOfSnapshot(
      spec.public_view as ProofCarrier,
    );
    expect(computed).toBe(spec.public_view_hash_hex);
  });
});
