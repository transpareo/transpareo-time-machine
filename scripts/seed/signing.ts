/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Seed-side proof signer. Per fixture run:
 *
 *   1. Derive two Ed25519 keypairs (issuer authority
 *      and platform authority) from fixed seed constants,
 *      so every seed run and every redeploy emits
 *      byte-identical signed fixtures (see SEED_NAMESPACE
 *      for why that matters). The keys are demo-only and
 *      not checked in.
 *
 *   2. For each snapshot, build a 5-entry W3C
 *      eddsa-jcs-2022 proof set: three entries point at
 *      issuer verificationMethod URLs, two at platform
 *      URLs. Each entry is signed independently over
 *      hashData = SHA-256(JCS(proofConfig)) ||
 *      SHA-256(JCS(snapshot minus proof)), where the
 *      proofConfig carries that entry's verificationMethod
 *      and the snapshot's @context (see
 *      src/crypto/eddsa-jcs). The three issuer entries
 *      resolve to the issuer key and the two platform
 *      entries to the platform key, the two distinct keys
 *      the renderer's 2-of-2 verdict expects.
 *
 *   3. Emit a Multikey resolution doc per authority
 *      under `public/<id>/dpp/<code>/keys/`. The
 *      proof entries' verificationMethod URLs all
 *      resolve back to one of those two documents at
 *      runtime (the host URLs are aliases that Vite
 *      serves from the same bytes via the fixture
 *      asset tree).
 *
 * Out of scope: real-world key custody, did:web
 * resolution beyond the file path, and any of the
 * issuer's HTTPS host machinery. This module
 * generates fixture data so the renderer's verifier
 * can exercise the full code path end to end without a
 * backend.
 */

import {
  createPrivateKey, createPublicKey, sign, createHash, type KeyObject,
} from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalize } from '../../src/crypto/jcs.ts';
import { encodeMultibaseBase58 } from '../../src/crypto/multibase.ts';
import {
  proofConfig, unsecuredDocument, EDDSA_JCS_2022,
} from '../../src/crypto/eddsa-jcs.ts';

export interface ProofEntry {
  readonly type: 'DataIntegrityProof';
  readonly cryptosuite: 'eddsa-jcs-2022';
  readonly created: string;
  readonly proofPurpose: 'assertionMethod';
  readonly verificationMethod: string;
  readonly proofValue: string;
}

// The manifest carries a single platform signature under
// `signature` (not the snapshot's `proof` array). Field
// order mirrors a ProofEntry minus the alias multiplicity.
export interface ManifestProof {
  readonly type: 'DataIntegrityProof';
  readonly cryptosuite: 'eddsa-jcs-2022';
  readonly created: string;
  readonly verificationMethod: string;
  readonly proofPurpose: 'assertionMethod';
  readonly proofValue: string;
}

// Ed25519 multikey prefix: 0xed 0x01 + 32-byte raw key.
const ED25519_MULTIKEY_PREFIX = new Uint8Array([0xed, 0x01]);

// PKCS#8 DER header for an Ed25519 private key (RFC 8410):
// the fixed ASN.1 prefix, then the 32-byte seed. Lets a
// deterministic seed become a Node private key without random
// generation.
const ED25519_PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b657004220420', 'hex',
);

interface AuthorityKey {
  readonly authorityId: string;
  readonly publicKeyMultibase: string;
  readonly privateKey: KeyObject;
}

export interface SnapshotSigner {
  signSnapshot(snapshot: Record<string, unknown>): ProofEntry[];
  signManifest(manifest: Record<string, unknown>): ManifestProof;
}

export async function buildSnapshotSigner(
  publicDir: string,
  issuerHandle: string,
  code: string,
  createdAt: string,
): Promise<SnapshotSigner> {
  const issuer = deriveAuthorityKey(`${issuerHandle}:issuer`);
  const platform = deriveAuthorityKey('transpareo:platform');

  await writeResolutionDocs(
    publicDir, issuerHandle, code, issuer, platform,
  );

  const issuerUrls = issuerVerificationMethods(issuerHandle, code);
  const platformUrls = platformVerificationMethods(issuerHandle, code);

  return {
    signSnapshot(snapshot: Record<string, unknown>): ProofEntry[] {
      // One eddsa-jcs-2022 signature per alias: each binds
      // its own verificationMethod through the proof config,
      // so the three issuer aliases and two platform aliases
      // all carry distinct signatures over a shared document
      // hash.
      const documentHash = sha256(canonicalize(unsecuredDocument(snapshot)));
      const context = snapshot['@context'];
      const proofs: ProofEntry[] = [];
      for (const url of issuerUrls) {
        proofs.push(
          signProofEntry(url, issuer.privateKey, documentHash, context),
        );
      }
      for (const url of platformUrls) {
        proofs.push(
          signProofEntry(url, platform.privateKey, documentHash, context),
        );
      }
      return proofs;
    },

    signManifest(manifest: Record<string, unknown>): ManifestProof {
      // The manifest's single platform signature, same
      // eddsa-jcs-2022 construction. This authenticates the
      // version list itself; verificationMethod is the first
      // platform alias.
      const documentHash = sha256(canonicalize(unsecuredDocument(manifest)));
      const context = manifest['@context'];
      const options: Omit<ManifestProof, 'proofValue'> = {
        type: 'DataIntegrityProof',
        cryptosuite: EDDSA_JCS_2022,
        created: createdAt,
        verificationMethod: platformUrls[0],
        proofPurpose: 'assertionMethod',
      };
      const proofConfigHash = sha256(canonicalize(proofConfig(options, context)));
      const hashData = concatBytes(proofConfigHash, documentHash);
      return {
        ...options,
        proofValue: encodeMultibaseBase58(
          signEd25519(platform.privateKey, hashData),
        ),
      };
    },
  };

  function signProofEntry(
    verificationMethod: string,
    privateKey: AuthorityKey['privateKey'],
    documentHash: Uint8Array,
    context: unknown,
  ): ProofEntry {
    const options: Omit<ProofEntry, 'proofValue'> = {
      type: 'DataIntegrityProof',
      cryptosuite: EDDSA_JCS_2022,
      created: createdAt,
      proofPurpose: 'assertionMethod',
      verificationMethod,
    };
    const proofConfigHash = sha256(canonicalize(proofConfig(options, context)));
    const hashData = concatBytes(proofConfigHash, documentHash);
    return {
      ...options,
      proofValue: encodeMultibaseBase58(signEd25519(privateKey, hashData)),
    };
  }
}

// Demo authority keys are derived from a fixed seed, not
// randomly generated, so every seed run and redeploy emits
// byte-identical signed fixtures. With random keys each build
// rotated them, and a returning client holding a snapshot in
// the HTTP cache then verified it against the freshly rotated
// keys for up to the cache TTL: every signature failed while
// the internally-consistent chain stayed green. A fixed seed
// removes the only non-deterministic input (fixture data and
// timestamps are fixed, Ed25519 signing is deterministic).
// Demo-only: a published seed is a published private key, so
// never derive real custody keys this way.
const SEED_NAMESPACE = 'transpareo-time-machine/demo-authority/v1';

function deriveAuthorityKey(authorityId: string): AuthorityKey {
  const privateKey = privateKeyFromSeed(
    sha256(`${SEED_NAMESPACE}:${authorityId}`),
  );
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
    throw new Error('derived a non-Ed25519 key, refusing to continue');
  }
  const rawKey = Buffer.from(jwk.x, 'base64url');
  if (rawKey.length !== 32) {
    throw new Error(`Ed25519 public key was ${rawKey.length} bytes, want 32`);
  }
  const multikey = concatBytes(ED25519_MULTIKEY_PREFIX, rawKey);
  return {
    authorityId,
    publicKeyMultibase: encodeMultibaseBase58(multikey),
    privateKey,
  };
}

// Wrap a 32-byte seed in the Ed25519 PKCS#8 envelope and let
// Node build the key. The seed IS the private key; the public
// half is derived from it, so the same seed always yields the
// same keypair.
function privateKeyFromSeed(seed: Uint8Array): KeyObject {
  if (seed.length !== 32) {
    throw new Error(`Ed25519 seed was ${seed.length} bytes, want 32`);
  }
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]);
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function issuerVerificationMethods(
  handle: string, code: string,
): string[] {
  // The three issuer aliases all resolve to the same
  // bytes (issuer.json); the URL variety is what the
  // 2-of-2 rule's authority count surfaces in the UI.
  const base = `/${handle}/dpp/${code}/keys`;
  return [
    `${base}/issuer.json`,
    `${base}/issuer.json#did-web`,
    `${base}/issuer.json#cdn`,
  ];
}

function platformVerificationMethods(
  handle: string, code: string,
): string[] {
  const base = `/${handle}/dpp/${code}/keys`;
  return [
    `${base}/platform.json`,
    `${base}/platform.json#did-web`,
  ];
}

async function writeResolutionDocs(
  publicDir: string,
  handle: string,
  code: string,
  issuer: AuthorityKey,
  platform: AuthorityKey,
): Promise<void> {
  const dir = join(publicDir, handle, 'dpp', code, 'keys');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'issuer.json'),
    JSON.stringify(multikeyDoc(issuer), null, 2) + '\n',
  );
  await writeFile(
    join(dir, 'platform.json'),
    JSON.stringify(multikeyDoc(platform), null, 2) + '\n',
  );
}

function multikeyDoc(key: AuthorityKey): Record<string, string> {
  return {
    id: key.authorityId,
    type: 'Multikey',
    controller: key.authorityId,
    publicKeyMultibase: key.publicKeyMultibase,
  };
}

function signEd25519(
  privateKey: KeyObject,
  message: Uint8Array,
): Uint8Array {
  // Node's sign(null, ...) for Ed25519 uses the message
  // bytes directly (no pre-hashing pass), which is what
  // crypto.subtle.verify expects on the browser side.
  return new Uint8Array(sign(null, message, privateKey));
}

function sha256(text: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(text, 'utf8').digest());
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
