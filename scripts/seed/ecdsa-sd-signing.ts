/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Seed-side ecdsa-sd-2023 issuer. Wraps a snapshot body as
 * a W3C Verifiable Credential (every node gets a stable
 * @id, so it canonicalizes with no blank nodes) and issues
 * TWO selective-disclosure derived proofs over it, one per
 * fixed demo P-256 key: the issuer's, then the platform's
 * counter-signature, matching production. The demo discloses
 * every field, so each derived view is all-mandatory (no
 * withheld tiers yet); the renderer verifies each proof
 * against the key its verificationMethod resolves to.
 *
 * ECDSA signing draws a random k, so unlike the eddsa-jcs
 * seed this output is not byte-identical across runs; the
 * fixed key keeps every run verifiable.
 *
 * Out of scope, as with the eddsa-jcs signer: real key
 * custody and any issuer HTTPS host machinery.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { canonicalize } from '../../src/crypto/rdfc.ts';
import { encodeBase64url } from '../../src/crypto/base64url.ts';
import { encodeMultibaseBase58 } from '../../src/crypto/multibase.ts';

const { subtle } = webcrypto;
type CryptoKey = webcrypto.CryptoKey;

// The two hosted contexts a DPP VC references by URL,
// loaded from the SPA's cached copies so the seed and the
// renderer canonicalize identically. Hardcoded here rather
// than imported from src/crypto/dpp-contexts, whose JSON
// imports are an app-config concern.
const VC_CONTEXT_URL = 'https://transpareo.com/vocab/vc/v1';
const TRANSPAREO_CONTEXT_URL = 'https://transpareo.com/vocab/transpareo/v1';
const CONTEXTS_DIR = join(import.meta.dirname, '..', '..', 'src', 'contexts');

// Demo-only issuer key. NOT a production key; it exists so
// `npm run seed` can issue a self-verifying ecdsa-sd fixture
// offline. P-256 (prime256v1) private JWK.
const ISSUER_JWK: webcrypto.JsonWebKey = {
  kty: 'EC', crv: 'P-256',
  d: 'WTfk1X1sIB-W4zsMUTCDVqP1RS840aMiX6_vP-Mbh_E',
  x: 'wS-TJvv6HJt9ZkPQN6B9tNc7hPhnLM_lzFznBdsfdBU',
  y: 'ldEw1SvUmaj9Hlgc3_dEJiHxb3cXFoKVISaJPmbSB0w',
};

// Demo-only platform key for the counter-signature; same
// caveat as ISSUER_JWK, not a production key.
const PLATFORM_JWK: webcrypto.JsonWebKey = {
  kty: 'EC', crv: 'P-256',
  d: 'febjdWsx991Xpsia3nO2sdzeyFmMPUsITxtzTiEiRJE',
  x: '5Wo2HnORp4UhQyHmLWYQ6V-ca6EuJjjFYyxGDygMP0U',
  y: '8sPwLZZKmyuP2RY0bufb2laLwlcFKMlLj-S_AjDdEVM',
};

const P256_MULTIKEY_PREFIX = Uint8Array.of(0x80, 0x24);

export interface EcdsaSdIssuer {
  // The proof-carrying credential for one snapshot body.
  issue(body: Record<string, unknown>): Promise<Record<string, unknown>>;
}

// Mirrors the eddsa-jcs signer: writes each authority's P-256
// key resolution doc under keys/, and every proof points at
// its own with a relative verificationMethod the SPA fetches
// from the fixture tree (no did:web needed for the demo).
export async function buildEcdsaSdIssuer(
  publicDir: string,
  issuerHandle: string,
  code: string,
  createdAt: string,
  issuerDid: string,
  platformDid: string,
): Promise<EcdsaSdIssuer> {
  const contexts = await loadContexts();
  const authorities = [
    await setupAuthority(
      ISSUER_JWK, publicDir, issuerHandle, code, 'issuer-p256.json', issuerDid,
    ),
    await setupAuthority(
      PLATFORM_JWK, publicDir, issuerHandle, code, 'platform-p256.json',
      platformDid,
    ),
  ];

  return {
    async issue(
      body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const vc = buildCredential(body, issuerDid);
      // Two derived proofs over the same all-mandatory view,
      // one per authority key: issuer, then platform.
      const proof = await Promise.all(
        authorities.map((a) => deriveAllMandatory(
          vc, a.key, a.verificationMethod, createdAt, contexts,
        )),
      );
      return { ...vc, proof };
    },
  };
}

interface Authority {
  readonly key: CryptoKey;
  readonly verificationMethod: string;
}

// Import an authority's P-256 key, write its Multikey
// resolution doc under keys/, and return the signing key +
// the relative verificationMethod its proofs point at.
async function setupAuthority(
  jwk: webcrypto.JsonWebKey,
  publicDir: string,
  issuerHandle: string,
  code: string,
  fileName: string,
  controllerDid: string,
): Promise<Authority> {
  const key = await subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'],
  );
  const pub = await subtle.importKey(
    'jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'],
  );
  const multikey = multikeyOf(
    new Uint8Array(await subtle.exportKey('raw', pub)),
  );
  const verificationMethod = `/${issuerHandle}/dpp/${code}/keys/${fileName}`;
  const dir = join(publicDir, issuerHandle, 'dpp', code, 'keys');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, fileName),
    JSON.stringify({
      id: verificationMethod,
      type: 'Multikey',
      controller: controllerDid,
      publicKeyMultibase: encodeMultibaseBase58(multikey),
    }, null, 2) + '\n',
  );
  return { key, verificationMethod };
}

async function loadContexts(): Promise<Record<string, unknown>> {
  const read = async (f: string): Promise<unknown> =>
    JSON.parse(await readFile(join(CONTEXTS_DIR, f), 'utf8'));
  return {
    [VC_CONTEXT_URL]: await read('vc-v1.json'),
    [TRANSPAREO_CONTEXT_URL]: await read('transpareo-v1.json'),
  };
}

// ─── VC envelope + stable @ids ──────────────────────

function buildCredential(
  body: Record<string, unknown>,
  issuerDid: string,
): Record<string, unknown> {
  const { '@context': _ctx, '@id': subjectId, ...rest } = body;
  const subjectIri = typeof subjectId === 'string'
    ? subjectId : `urn:transpareo:dpp:${String(body.passportAlias ?? '')}`;
  // RDF canonicalization has no unambiguous lexical form for
  // a bare non-integer JSON number, so the credential carries
  // decimals as strings (integers like `version` stay
  // numbers). This matches the hosted issuer's serialization.
  const subject = stringifyDecimals(
    { '@id': subjectIri, ...rest },
  ) as Record<string, unknown>;
  assignIds(subject, subjectIri, undefined);
  return {
    '@context': [VC_CONTEXT_URL, TRANSPAREO_CONTEXT_URL],
    '@id': `${subjectIri}#credential`,
    type: ['VerifiableCredential', 'dpp:DigitalProductPassport'],
    issuer: issuerDid,
    credentialSubject: subject,
  };
}

// Give every node a deterministic @id: an elementId or
// propertyID when present (stable across reordering), else
// the path from the nearest identified ancestor. Value
// objects ({ @value, ... }) are literals and are skipped.
function assignIds(
  node: Record<string, unknown>, subjectIri: string, frag: string | undefined,
): void {
  if ('@value' in node) return;
  if (node['@id'] === undefined) {
    node['@id'] = frag ? `${subjectIri}#${frag}` : subjectIri;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@')) continue;
    descend(value, subjectIri, frag, key);
  }
}

function descend(
  value: unknown, subjectIri: string,
  parentFrag: string | undefined, key: string,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (isPlainNode(item)) {
        assignIds(item, subjectIri, fragmentFor(item, parentFrag, key, index));
      }
    });
  } else if (isPlainNode(value)) {
    assignIds(value, subjectIri, fragmentFor(value, parentFrag, key, null));
  }
}

function isPlainNode(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    && !('@value' in (v as Record<string, unknown>));
}

function fragmentFor(
  node: Record<string, unknown>, parentFrag: string | undefined,
  key: string, index: number | null,
): string {
  const eid = node.elementId;
  if (typeof eid === 'string' && eid) {
    return eid.replace(/[^A-Za-z0-9._/-]/g, '-');
  }
  const pid = node.propertyID;
  if (typeof pid === 'string' && pid) return `property/${slug(pid)}`;
  const seg = index === null ? key : `${key}/${index}`;
  return parentFrag ? `${parentFrag}/${seg}` : seg;
}

function slug(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Deep-copy, rewriting every non-integer number to its
// string form so the credential canonicalizes to RDF.
function stringifyDecimals(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : String(value);
  }
  if (Array.isArray(value)) return value.map(stringifyDecimals);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stringifyDecimals(v);
    return out;
  }
  return value;
}

// ─── ecdsa-sd derived proof (all-mandatory) ─────────

const DERIVED_TAG = [0xd9, 0x5d, 0x01];

async function deriveAllMandatory(
  vc: Record<string, unknown>, issuerKey: CryptoKey,
  verificationMethod: string, createdAt: string,
  contexts: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const options = {
    type: 'DataIntegrityProof',
    cryptosuite: 'ecdsa-sd-2023',
    created: createdAt,
    verificationMethod,
    proofPurpose: 'assertionMethod',
  };
  const proofConfig = { '@context': vc['@context'], ...options };
  const proofHash = await sha256(utf8(
    (await canonicalize(proofConfig, { contexts })).join(''),
  ));

  const nquads = await canonicalize(vc, { contexts });
  const mandatoryHash = await sha256(utf8(nquads.join('')));

  // A proof-scoped key still binds the base signature even
  // when nothing is selectively disclosed.
  const scoped = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  );
  const scopedMultikey = multikeyOf(
    new Uint8Array(await subtle.exportKey('raw', scoped.publicKey)),
  );
  const baseSignature = await sign(
    issuerKey, concat(proofHash, scopedMultikey, mandatoryHash),
  );
  const mandatoryIndexes = nquads.map((_, i) => i);
  const proofValue = encodeDerived(
    baseSignature, scopedMultikey, mandatoryIndexes,
  );
  return { ...options, proofValue };
}

function encodeDerived(
  baseSignature: Uint8Array, publicKey: Uint8Array, mandatoryIndexes: number[],
): string {
  // tag(0xd95d01) [ baseSignature, publicKey, [], {}, indexes ]
  const inner = cborArray([
    cborBytes(baseSignature), cborBytes(publicKey),
    cborArray([]), cborMapEmpty(), cborArray(mandatoryIndexes.map(cborUint)),
  ]);
  return 'u' + encodeBase64url(Uint8Array.from([...DERIVED_TAG, ...inner]));
}

// ─── minimal CBOR encoder ───────────────────────────

function head(major: number, len: number): number[] {
  const mt = major << 5;
  if (len < 24) return [mt | len];
  if (len < 0x100) return [mt | 24, len];
  if (len < 0x10000) return [mt | 25, len >> 8, len & 0xff];
  return [mt | 26, (len >>> 24) & 0xff, (len >> 16) & 0xff,
    (len >> 8) & 0xff, len & 0xff];
}
const cborBytes = (b: Uint8Array): number[] => [...head(2, b.length), ...b];
const cborUint = (n: number): number[] => head(0, n);
const cborArray = (items: number[][]): number[] =>
  [...head(4, items.length), ...items.flat()];
const cborMapEmpty = (): number[] => head(5, 0);

// ─── crypto helpers ─────────────────────────────────

function multikeyOf(uncompressed: Uint8Array): Uint8Array {
  const compressed = new Uint8Array(33);
  compressed[0] = (uncompressed[64] & 1) === 1 ? 0x03 : 0x02;
  compressed.set(uncompressed.subarray(1, 33), 1);
  const out = new Uint8Array(35);
  out.set(P256_MULTIKEY_PREFIX, 0);
  out.set(compressed, 2);
  return out;
}

async function sign(key: CryptoKey, message: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, message,
  ));
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-256', bytes));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
