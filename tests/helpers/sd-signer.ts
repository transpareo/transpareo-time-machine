/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Test-only ecdsa-sd-2023 issuer: the specs mint their own
 * base + derived proofs here with WebCrypto P-256 and an
 * inline CBOR encoder, then verify them through the
 * production path. Shared by ecdsa-sd.spec.ts and
 * dispatch.spec.ts so the signing construction lives in one
 * place.
 */

import { canonicalize } from '../../src/crypto/rdfc';
import { asBuffer } from '../../src/crypto/buffer';
import { encodeBase64url } from '../../src/crypto/base64url';
import { ECDSA_SD_2023 } from '../../src/crypto/ecdsa-sd';

export interface Key {
  readonly priv: CryptoKey;
  readonly multikey: Uint8Array;
}

export type Corruption = 'base-sig' | 'statement-sig';

// A fresh P-256 key plus its 35-byte Multikey (0x8024
// multicodec prefix + compressed point).
export async function generateKey(): Promise<Key> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  );
  const raw = new Uint8Array(
    await crypto.subtle.exportKey('raw', pair.publicKey),
  );
  const compressed = new Uint8Array(33);
  compressed[0] = (raw[64] & 1) === 1 ? 0x03 : 0x02;
  compressed.set(raw.subarray(1, 33), 1);
  const multikey = new Uint8Array(35);
  multikey.set([0x80, 0x24], 0);
  multikey.set(compressed, 2);
  return { priv: pair.privateKey, multikey };
}

async function sign(key: Key, message: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key.priv, asBuffer(message),
  ));
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', asBuffer(bytes)),
  );
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const joinBytes = (lines: string[]): Uint8Array => utf8(lines.join(''));

// --- inline CBOR encoder (test-only) ------------------

function head(major: number, len: number): number[] {
  const mt = major << 5;
  if (len < 24) return [mt | len];
  if (len < 0x100) return [mt | 24, len];
  if (len < 0x10000) return [mt | 25, len >> 8, len & 0xff];
  throw new Error('length too large for the test CBOR encoder');
}
const cborBytes = (b: Uint8Array): number[] => [...head(2, b.length), ...b];
const cborUint = (n: number): number[] => head(0, n);
const cborArr = (items: number[][]): number[] =>
  [...head(4, items.length), ...items.flat()];
const cborMap = (entries: Array<[number, Uint8Array]>): number[] =>
  [...head(5, entries.length),
    ...entries.flatMap(([k, v]) => [...cborUint(k), ...cborBytes(v)])];
const cborTag2 = (tag: number, inner: number[]): number[] =>
  [0xd9, (tag >> 8) & 0xff, tag & 0xff, ...inner];

export interface DerivedComponents {
  readonly baseSignature: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly signatures: readonly Uint8Array[];
  readonly labelMap: ReadonlyArray<[number, Uint8Array]>;
  readonly mandatoryIndexes: readonly number[];
}

export function encodeDerivedProofValue(c: DerivedComponents): string {
  const inner = cborArr([
    cborBytes(c.baseSignature),
    cborBytes(c.publicKey),
    cborArr(c.signatures.map(cborBytes)),
    cborMap([...c.labelMap]),
    cborArr(c.mandatoryIndexes.map(cborUint)),
  ]);
  return 'u' + encodeBase64url(Uint8Array.from(cborTag2(0x5d01, inner)));
}

// SHA-256 of the canonical proof options: what the base
// signature binds as the proofHash.
export async function proofHashOf(
  context: unknown, proofBlock: Record<string, unknown>,
): Promise<Uint8Array> {
  return sha256(joinBytes(await canonicalize({ '@context': context, ...proofBlock })));
}

// The mandatory statements are those the given
// mandatory-only document canonicalizes to; any derived
// view's N-Quads matching them are the mandatory subset.
export async function mandatoryNQuadsOf(
  mandatoryDoc: Record<string, unknown>,
): Promise<Set<string>> {
  return new Set(await canonicalize(mandatoryDoc));
}

export interface BuildDerivedArgs {
  readonly doc: Record<string, unknown>;
  readonly mandatoryNQuads: ReadonlySet<string>;
  readonly issuer: Key;
  readonly proofScoped: Key;
  readonly proofHash: Uint8Array;
  readonly proofBlock: Record<string, unknown>;
  readonly corrupt?: Corruption;
}

// Assemble a signed derived-proof document from a revealed
// document (proof attached, no label map: our documents
// carry explicit @ids, so there are no blank nodes to
// relabel).
export async function buildDerivedDoc(
  args: BuildDerivedArgs,
): Promise<Record<string, unknown>> {
  const nquads = await canonicalize(args.doc);
  const mandatoryIndexes: number[] = [];
  const mandatory: string[] = [];
  const nonMandatory: string[] = [];
  nquads.forEach((nq, i) => {
    if (args.mandatoryNQuads.has(nq)) {
      mandatoryIndexes.push(i);
      mandatory.push(nq);
    } else nonMandatory.push(nq);
  });

  const mandatoryHash = await sha256(joinBytes(mandatory));
  const baseData = concat(args.proofHash, args.proofScoped.multikey, mandatoryHash);
  const baseSignature = await sign(args.issuer, baseData);
  if (args.corrupt === 'base-sig') baseSignature[0] ^= 0xff;

  const signatures: Uint8Array[] = [];
  for (const nq of nonMandatory) {
    signatures.push(await sign(args.proofScoped, utf8(nq)));
  }
  if (args.corrupt === 'statement-sig' && signatures.length > 0) {
    signatures[0][0] ^= 0xff;
  }

  const proofValue = encodeDerivedProofValue({
    baseSignature,
    publicKey: args.proofScoped.multikey,
    signatures,
    labelMap: [],
    mandatoryIndexes,
  });
  return { ...args.doc, proof: { ...args.proofBlock, proofValue } };
}

// --- a ready-made sample issuer + vocabulary -----------

// A small battery-DPP vocabulary with explicit @ids (no
// blank nodes) and the Data Integrity proof terms the
// proof-options canonicalization needs. Shared so the
// ecdsa-sd and dispatch specs agree on one document shape.
export const SAMPLE_CONTEXT = {
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  sec: 'https://w3id.org/security#',
  ex: 'https://ex.dpp/vocab#',
  DigitalProductPassport: 'ex:DigitalProductPassport',
  DataIntegrityProof: 'sec:DataIntegrityProof',
  name: 'ex:name',
  capacity: 'ex:capacity',
  recycled: 'ex:recycled',
  hazard: 'ex:hazard',
  type: '@type',
  cryptosuite: 'sec:cryptosuite',
  created: {
    '@id': 'http://purl.org/dc/terms/created', '@type': 'xsd:dateTime',
  },
  verificationMethod: { '@id': 'sec:verificationMethod', '@type': '@id' },
  proofPurpose: { '@id': 'sec:proofPurpose', '@type': '@id' },
  proofValue: 'sec:proofValue',
  assertionMethod: 'sec:assertionMethod',
};

export const SAMPLE_PASSPORT_ID = 'https://ex.dpp/passport/1';
export const SAMPLE_MANDATORY: Record<string, string> = {
  name: 'Pulse 2000', capacity: '2.0 kWh',
};
export const SAMPLE_DISCLOSABLE: Record<string, string> = {
  recycled: '78%', hazard: '2 entries',
};
export const SAMPLE_PROOF_BLOCK: Record<string, unknown> = {
  type: 'DataIntegrityProof',
  cryptosuite: ECDSA_SD_2023,
  created: '2026-07-18T00:00:00Z',
  verificationMethod: 'https://ex.dpp/issuer#key-1',
  proofPurpose: 'assertionMethod',
};

export interface SampleSigner {
  readonly issuer: Key;
  makeDerived(
    reveal: string[], corrupt?: Corruption,
  ): Promise<Record<string, unknown>>;
}

// One call sets up an issuer over the sample vocabulary and
// returns a maker: pass the disclosable fields to reveal
// (mandatory ones are always present) and an optional
// corruption to exercise the failure paths.
export async function createSampleSigner(): Promise<SampleSigner> {
  const issuer = await generateKey();
  const proofScoped = await generateKey();
  const proofHash = await proofHashOf(SAMPLE_CONTEXT, SAMPLE_PROOF_BLOCK);
  const mandatoryNQuads = await mandatoryNQuadsOf({
    '@context': SAMPLE_CONTEXT, '@id': SAMPLE_PASSPORT_ID,
    type: 'DigitalProductPassport', ...SAMPLE_MANDATORY,
  });

  function makeDerived(
    reveal: string[], corrupt?: Corruption,
  ): Promise<Record<string, unknown>> {
    const doc: Record<string, unknown> = {
      '@context': SAMPLE_CONTEXT, '@id': SAMPLE_PASSPORT_ID,
      type: 'DigitalProductPassport', ...SAMPLE_MANDATORY,
    };
    for (const field of reveal) doc[field] = SAMPLE_DISCLOSABLE[field];
    return buildDerivedDoc({
      doc, mandatoryNQuads, issuer, proofScoped, proofHash,
      proofBlock: SAMPLE_PROOF_BLOCK, corrupt,
    });
  }

  return { issuer, makeDerived };
}
