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

import { generateKeyPairSync, sign, createHash } from 'node:crypto';
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
