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
});
