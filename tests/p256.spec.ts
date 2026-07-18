/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * P-256 verify + point-decompression coverage for
 * src/crypto/p256.ts. The signer here is WebCrypto
 * itself: generate a key, sign, then verify through the
 * compressed and Multikey import paths. A decompression
 * bug (wrong square root or wrong parity) recovers a
 * different point, so verification would fail; a passing
 * verify is therefore evidence the point was recovered
 * exactly.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { importP256PublicKey, verifyP256 } from '../src/crypto/p256';

const MESSAGE = new TextEncoder().encode('ecdsa-sd statement');

let uncompressed: Uint8Array;
let compressed: Uint8Array;
let multikey: Uint8Array;
let signature: Uint8Array;

// Derive the 33-byte compressed encoding from a 65-byte
// uncompressed point: parity byte (0x02 even, 0x03 odd)
// taken from the last byte of Y, then X.
function compress(point: Uint8Array): Uint8Array {
  const x = point.subarray(1, 33);
  const yOdd = (point[64] & 1) === 1;
  const out = new Uint8Array(33);
  out[0] = yOdd ? 0x03 : 0x02;
  out.set(x, 1);
  return out;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  );
  uncompressed = new Uint8Array(
    await crypto.subtle.exportKey('raw', pair.publicKey),
  );
  compressed = compress(uncompressed);
  multikey = new Uint8Array(35);
  multikey.set([0x80, 0x24], 0);
  multikey.set(compressed, 2);
  signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, MESSAGE,
    ),
  );
});

describe('importP256PublicKey: accepts each key encoding', () => {
  it('verifies through the uncompressed (65-byte) form', async () => {
    const key = await importP256PublicKey(uncompressed);
    expect(await verifyP256(key, signature, MESSAGE)).toBe(true);
  });

  it('verifies through the compressed (33-byte) form', async () => {
    const key = await importP256PublicKey(compressed);
    expect(await verifyP256(key, signature, MESSAGE)).toBe(true);
  });

  it('verifies through the P-256 Multikey (35-byte, 0x8024) form', async () => {
    const key = await importP256PublicKey(multikey);
    expect(await verifyP256(key, signature, MESSAGE)).toBe(true);
  });
});

describe('verifyP256: rejects bad inputs', () => {
  it('rejects a tampered signature', async () => {
    const key = await importP256PublicKey(compressed);
    const bad = Uint8Array.from(signature);
    bad[0] ^= 0xff;
    expect(await verifyP256(key, bad, MESSAGE)).toBe(false);
  });

  it('rejects a tampered message', async () => {
    const key = await importP256PublicKey(compressed);
    const other = new TextEncoder().encode('ecdsa-sd statemenT');
    expect(await verifyP256(key, signature, other)).toBe(false);
  });

  it('rejects a signature of the wrong length (not 64 bytes)', async () => {
    const key = await importP256PublicKey(compressed);
    expect(await verifyP256(key, signature.subarray(0, 63), MESSAGE))
      .toBe(false);
  });
});

describe('importP256PublicKey: rejects malformed keys', () => {
  it('rejects an unknown length', async () => {
    await expect(importP256PublicKey(new Uint8Array(34)))
      .rejects.toThrow(/unexpected P-256 key length/);
  });

  it('rejects a compressed point with a bad parity prefix', async () => {
    const bad = Uint8Array.from(compressed);
    bad[0] = 0x05;
    await expect(importP256PublicKey(bad))
      .rejects.toThrow(/malformed compressed P-256 point/);
  });

  it('rejects a 35-byte key without the 0x8024 Multikey prefix', async () => {
    const bad = Uint8Array.from(multikey);
    bad[1] = 0x00;
    await expect(importP256PublicKey(bad))
      .rejects.toThrow(/not a P-256 Multikey/);
  });

  it('rejects an uncompressed point without the 0x04 prefix', async () => {
    const bad = Uint8Array.from(uncompressed);
    bad[0] = 0x00;
    await expect(importP256PublicKey(bad))
      .rejects.toThrow(/malformed uncompressed P-256 point/);
  });

  it('rejects an X coordinate at or beyond the field prime', async () => {
    // 0x02 || 0xff*32: X = 2^256 - 1 > P, out of range.
    const bad = new Uint8Array(33);
    bad[0] = 0x02;
    bad.fill(0xff, 1);
    await expect(importP256PublicKey(bad))
      .rejects.toThrow(/out of field range/);
  });
});
