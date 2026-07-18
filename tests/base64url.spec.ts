/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Multibase base64url ('u' prefix, unpadded) decode
 * coverage for src/crypto/base64url.ts. This is the
 * container the ecdsa-sd-2023 proofValue arrives in;
 * the verifier must decode it byte-for-byte before
 * handing the CBOR to the parser.
 *
 * The oracle is Node's Buffer base64url decoder: for
 * every case the hand-rolled decoder must agree with it.
 */

import { describe, expect, it } from 'vitest';
import {
  decodeMultibaseBase64url, encodeBase64url,
} from '../src/crypto/base64url';

// Decode via Node's Buffer as an independent reference.
function oracle(base64url: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64url, 'base64url'));
}

describe('decodeMultibaseBase64url: prefix handling', () => {
  it('rejects strings without the u prefix', () => {
    expect(() => decodeMultibaseBase64url('AQID'))
      .toThrow(/not a u-prefixed/);
  });

  it('rejects the empty string', () => {
    expect(() => decodeMultibaseBase64url(''))
      .toThrow(/not a u-prefixed/);
  });

  it('decodes bare "u" to an empty byte string', () => {
    expect(decodeMultibaseBase64url('u')).toEqual(new Uint8Array(0));
  });
});

describe('decodeMultibaseBase64url: known vectors', () => {
  const cases: Array<{ mb: string; bytes: number[] }> = [
    { mb: 'uAQID', bytes: [1, 2, 3] },
    { mb: 'uAQ', bytes: [1] },
    { mb: 'uAQI', bytes: [1, 2] },
    { mb: 'u_w', bytes: [0xff] },
    { mb: 'u__8', bytes: [0xff, 0xff] },
    { mb: 'u____', bytes: [0xff, 0xff, 0xff] },
  ];

  for (const { mb, bytes } of cases) {
    it(`${mb} -> [${bytes.join(', ')}]`, () => {
      expect(decodeMultibaseBase64url(mb))
        .toEqual(new Uint8Array(bytes));
    });
  }

  it('uses -/_ (url alphabet), not +/', () => {
    // 0xfb 0xff 0xbf -> base64 "+/+/", base64url "-_-_".
    expect(decodeMultibaseBase64url('u-_-_'))
      .toEqual(new Uint8Array([0xfb, 0xff, 0xbf]));
  });
});

describe('decodeMultibaseBase64url: rejects malformed input', () => {
  it('rejects "=" padding (base64url is unpadded)', () => {
    // 'QQ==' is the padded base64 for one byte; base64url
    // drops the padding, so '=' must read as an invalid
    // character. A length-4 group reaches the char scan
    // rather than tripping the length guard first.
    expect(() => decodeMultibaseBase64url('uQQ=='))
      .toThrow(/invalid base64url char/);
  });

  it('rejects a base64 (non-url) "+" character', () => {
    expect(() => decodeMultibaseBase64url('uA+ID'))
      .toThrow(/invalid base64url char/);
  });

  it('rejects a base64 (non-url) "/" character', () => {
    expect(() => decodeMultibaseBase64url('uA/ID'))
      .toThrow(/invalid base64url char/);
  });

  it('rejects a length that is 1 mod 4', () => {
    expect(() => decodeMultibaseBase64url('uABCDE'))
      .toThrow(/invalid base64url length/);
  });
});

describe('encodeBase64url: agrees with the Buffer oracle and round-trips', () => {
  it('matches Node base64url and decodes back for every length', () => {
    // A 32-byte HMAC label is the real payload; cover all
    // three tail classes (0/1/2 bytes over a multiple of 3).
    for (let len = 0; len <= 48; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = (len * 41 + i * 59) & 0xff;
      }
      const encoded = encodeBase64url(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString('base64url'));
      expect(decodeMultibaseBase64url('u' + encoded)).toEqual(bytes);
    }
  });
});

describe('decodeMultibaseBase64url: agrees with the Buffer oracle', () => {
  it('matches on a proofValue-sized random byte range', () => {
    // Cover every payload length 0..96 (a derived proof is
    // hundreds of bytes; this exercises all four remainder
    // classes many times over). Encode with the oracle,
    // decode with ours, and require equality.
    for (let len = 0; len <= 96; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = (len * 37 + i * 53) & 0xff;
      }
      const base64url = Buffer.from(bytes).toString('base64url');
      const decoded = decodeMultibaseBase64url('u' + base64url);
      expect(decoded).toEqual(bytes);
      // And the oracle round-trips the same string.
      expect(decoded).toEqual(oracle(base64url));
    }
  });
});
