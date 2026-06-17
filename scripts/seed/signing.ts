/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Seed-side proof signer. Per fixture run:
 *
 *   1. Generate two Ed25519 keypairs (issuer
 *      authority and platform authority). Keys are
 *      scoped to one `npm run seed` invocation; they
 *      are not checked in. Every dev who runs the seed
 *      gets fresh keys.
 *
 *   2. For each snapshot in the fixture: SHA-256 of the
 *      JCS-canonicalized snapshot body (i.e. the
 *      snapshot stripped of its `proof` field) is the
 *      signing input; sign with each authority's key
 *      once. The result is two raw 64-byte signatures.
 *
 *   3. Wrap the signatures in a 5-entry proof set:
 *      three entries point at three different issuer
 *      verificationMethod URLs and share the issuer
 *      signature value; two point at platform URLs and
 *      share the platform signature value. The five
 *      entries verify against two distinct public keys,
 *      which is the structural shape the renderer's
 *      2-of-2 aggregate verdict expects.
 *
 *   4. Emit a Multikey resolution doc per authority
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

import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalize } from '../../src/crypto/jcs.ts';
import { encodeMultibaseBase58 } from '../../src/crypto/multibase.ts';

export interface ProofEntry {
  readonly type: 'DataIntegrityProof';
  readonly cryptosuite: 'eddsa-jcs-sha256';
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
  readonly cryptosuite: 'eddsa-jcs-sha256';
  readonly created: string;
  readonly verificationMethod: string;
  readonly proofPurpose: 'assertionMethod';
  readonly proofValue: string;
}

// Ed25519 multikey prefix: 0xed 0x01 + 32-byte raw key.
const ED25519_MULTIKEY_PREFIX = new Uint8Array([0xed, 0x01]);

interface AuthorityKey {
  readonly authorityId: string;
  readonly publicKeyMultibase: string;
  readonly privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
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
  const issuer = generateAuthorityKey(`${issuerHandle}:issuer`);
  const platform = generateAuthorityKey('transpareo:platform');

  await writeResolutionDocs(
    publicDir, issuerHandle, code, issuer, platform,
  );

  const issuerUrls = issuerVerificationMethods(issuerHandle, code);
  const platformUrls = platformVerificationMethods(issuerHandle, code);

  return {
    signSnapshot(snapshot: Record<string, unknown>): ProofEntry[] {
      // Sign the JCS hash of the snapshot body without
      // its proof field. Per-authority signature is
      // reused across that authority's alias entries.
      const { proof: _proof, ...body } = snapshot;
      const hash = sha256(canonicalize(body));
      const issuerSig = signEd25519(issuer.privateKey, hash);
      const platformSig = signEd25519(platform.privateKey, hash);

      const proofs: ProofEntry[] = [];
      for (const url of issuerUrls) {
        proofs.push(buildProofEntry(url, issuerSig, createdAt));
      }
      for (const url of platformUrls) {
        proofs.push(buildProofEntry(url, platformSig, createdAt));
      }
      return proofs;
    },

    signManifest(manifest: Record<string, unknown>): ManifestProof {
      // Sign the JCS hash of the manifest body without its
      // signature (or proof) field, with the platform key
      // only. This authenticates the version list itself;
      // verificationMethod is the first platform alias.
      const { proof: _proof, signature: _sig, ...body } = manifest;
      const hash = sha256(canonicalize(body));
      const platformSig = signEd25519(platform.privateKey, hash);
      return {
        type: 'DataIntegrityProof',
        cryptosuite: 'eddsa-jcs-sha256',
        created: createdAt,
        verificationMethod: platformUrls[0],
        proofPurpose: 'assertionMethod',
        proofValue: encodeMultibaseBase58(platformSig),
      };
    },
  };
}

function generateAuthorityKey(authorityId: string): AuthorityKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
    throw new Error('node generated a non-Ed25519 key, refusing to continue');
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

function buildProofEntry(
  verificationMethod: string,
  signatureBytes: Uint8Array,
  createdAt: string,
): ProofEntry {
  return {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-sha256',
    created: createdAt,
    proofPurpose: 'assertionMethod',
    verificationMethod,
    proofValue: encodeMultibaseBase58(signatureBytes),
  };
}

function signEd25519(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
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
