/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Interop pin for the W3C eddsa-jcs-2022 construction
 * (src/crypto/eddsa-jcs + the JCS canonicaliser). Unlike
 * verify.spec.ts, which signs with our own helpers and would
 * pass even if signer and verifier were wrong in the same
 * way, this reproduces the published worked example from the
 * W3C "Data Integrity EdDSA Cryptosuites" spec and asserts
 * our pipeline lands on the spec's exact hashes and that the
 * spec's signature verifies. The values are Examples 30, 32,
 * 33, 35, 36 and 38 of https://www.w3.org/TR/vc-di-eddsa/.
 */

import { describe, it, expect } from 'vitest';
import { canonicalize } from '../src/crypto/jcs';
import { decodeMultibaseBase58 } from '../src/crypto/multibase';
import { proofConfig, joinHashes } from '../src/crypto/eddsa-jcs';

// Example 30: the unsecured document.
const DOCUMENT = {
  '@context': [
    'https://www.w3.org/ns/credentials/v2',
    'https://www.w3.org/ns/credentials/examples/v2',
  ],
  id: 'urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33',
  type: ['VerifiableCredential', 'AlumniCredential'],
  name: 'Alumni Credential',
  description: 'A minimum viable example of an Alumni Credential.',
  issuer: 'https://vc.example/issuers/5678',
  validFrom: '2023-01-01T00:00:00Z',
  credentialSubject: {
    id: 'did:example:abcdefgh',
    alumniOf: 'The School of Examples',
  },
};

const KEY_MB = 'z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2';

// Example 33: the proof options (a.k.a. proof config). The
// verificationMethod is the did:key form of the key above.
const PROOF_OPTIONS = {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: '2023-02-24T23:36:38Z',
  verificationMethod: `did:key:${KEY_MB}#${KEY_MB}`,
  proofPurpose: 'assertionMethod',
  '@context': DOCUMENT['@context'],
};

// Example 32 / 35 / 36 / 38.
const DOCUMENT_HASH_HEX =
  '59b7cb6251b8991add1ce0bc83107e3db9dbbab5bd2c28f687db1a03abc92f19';
const PROOF_CONFIG_HASH_HEX =
  '66ab154f5c2890a140cb8388a22a160454f80575f6eae09e5a097cabe539a1db';
const HASH_DATA_HEX = PROOF_CONFIG_HASH_HEX + DOCUMENT_HASH_HEX;
const PROOF_VALUE =
  'z2HnFSSPPBzR36zdDgK8PbEHeXbR56YF24jwMpt3R1eHXQzJDMWS93FCzpvJpwTWd3GAVFuUfjoJdcnTMuVor51aX';

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

async function sha256Jcs(value: unknown): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(canonicalize(value));
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function asBuffer(u: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u.byteLength);
  new Uint8Array(out).set(u);
  return out;
}

// Same SPKI wrapping the verifier uses to import a raw
// Ed25519 public key (Firefox rejects 'raw').
const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

function rawKeyToSpki(raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(ED25519_SPKI_PREFIX.length + raw.length);
  out.set(ED25519_SPKI_PREFIX, 0);
  out.set(raw, ED25519_SPKI_PREFIX.length);
  return out;
}

describe('eddsa-jcs-2022 construction (W3C vector)', () => {
  it('hashes the document to the spec value', async () => {
    expect(hex(await sha256Jcs(DOCUMENT))).toBe(DOCUMENT_HASH_HEX);
  });

  it('hashes the proof config to the spec value', async () => {
    expect(hex(await sha256Jcs(PROOF_OPTIONS))).toBe(PROOF_CONFIG_HASH_HEX);
  });

  it('proofConfig() binds @context and matches the spec config hash', async () => {
    // Drop @context from the options and let proofConfig add
    // it back from the document, the path the signer/verifier
    // take; it must reproduce Example 33 byte for byte.
    const { '@context': _ctx, ...optionsNoContext } = PROOF_OPTIONS;
    const built = proofConfig(optionsNoContext, DOCUMENT['@context']);
    expect(canonicalize(built)).toBe(canonicalize(PROOF_OPTIONS));
    expect(hex(await sha256Jcs(built))).toBe(PROOF_CONFIG_HASH_HEX);
  });

  it('joins the hashes in proof-config-first order', async () => {
    const documentHash = await sha256Jcs(DOCUMENT);
    const proofConfigHash = await sha256Jcs(PROOF_OPTIONS);
    expect(hex(joinHashes(proofConfigHash, documentHash))).toBe(HASH_DATA_HEX);
  });

  it('verifies the spec proofValue over the hashData', async () => {
    const documentHash = await sha256Jcs(DOCUMENT);
    const proofConfigHash = await sha256Jcs(PROOF_OPTIONS);
    const hashData = joinHashes(proofConfigHash, documentHash);

    const multikey = decodeMultibaseBase58(KEY_MB);
    expect(multikey.length).toBe(34);
    expect(multikey[0]).toBe(0xed);
    expect(multikey[1]).toBe(0x01);
    const rawKey = multikey.slice(2);

    const signature = decodeMultibaseBase58(PROOF_VALUE);
    expect(signature.length).toBe(64);

    const key = await crypto.subtle.importKey(
      'spki', asBuffer(rawKeyToSpki(rawKey)), { name: 'Ed25519' },
      false, ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' }, key, asBuffer(signature), asBuffer(hashData),
    );
    expect(ok).toBe(true);
  });
});
