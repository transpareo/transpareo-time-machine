/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Multibase base58btc (Bitcoin alphabet, 'z' prefix)
 * encode/decode coverage for src/crypto/multibase.ts.
 * The encoder is on the seed side, the decoder is on
 * the verifier side; both must agree byte-for-byte on
 * signatures and Multikey public keys.
 */

import { describe, expect, it } from 'vitest';
import {
  encodeMultibaseBase58, decodeMultibaseBase58,
} from '../src/crypto/multibase';

function hex(s: string): Uint8Array {
  if (s.length % 2 !== 0) {
    throw new Error('hex string must have even length');
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('encodeMultibaseBase58: prefix and shape', () => {
  it('prefixes the output with "z"', () => {
    expect(encodeMultibaseBase58(new Uint8Array([1])).startsWith('z'))
      .toBe(true);
  });

  it('encodes the empty byte string as bare "z"', () => {
    expect(encodeMultibaseBase58(new Uint8Array(0))).toBe('z');
  });

  it('encodes a single byte 0x01 as "z2"', () => {
    // The Bitcoin alphabet starts at '1' for digit 0; the
    // digit 1 maps to '2'.
    expect(encodeMultibaseBase58(new Uint8Array([0x01]))).toBe('z2');
  });

  it('encodes a single byte 0x39 as "zz"', () => {
    // 0x39 = 57 = the last index in the 58-char alphabet.
    expect(encodeMultibaseBase58(new Uint8Array([0x39]))).toBe('zz');
  });

  it('encodes a value crossing the 58 boundary correctly', () => {
    // 58 in base-58 is 1*58 + 0 = "21".
    expect(encodeMultibaseBase58(new Uint8Array([0x3a]))).toBe('z21');
  });
});

describe('encodeMultibaseBase58: leading zeros', () => {
  it('one leading zero becomes one leading "1"', () => {
    // Bitcoin alphabet: '1' is the digit-zero character,
    // so each leading zero byte renders as '1'.
    expect(encodeMultibaseBase58(new Uint8Array([0, 1]))).toBe('z12');
  });

  it('multiple leading zeros stack', () => {
    expect(encodeMultibaseBase58(new Uint8Array([0, 0, 0, 1])))
      .toBe('z1112');
  });

  it('all-zero bytes encode as the matching count of "1"s', () => {
    expect(encodeMultibaseBase58(new Uint8Array([0, 0, 0]))).toBe('z111');
  });
});

describe('decodeMultibaseBase58: prefix handling', () => {
  it('rejects strings without the z prefix', () => {
    expect(() => decodeMultibaseBase58('2'))
      .toThrow(/not a z-prefixed/);
  });

  it('rejects the empty string', () => {
    expect(() => decodeMultibaseBase58(''))
      .toThrow(/not a z-prefixed/);
  });

  it('decodes bare "z" to an empty byte string', () => {
    expect(decodeMultibaseBase58('z')).toEqual(new Uint8Array(0));
  });
});

describe('decodeMultibaseBase58: invalid alphabet', () => {
  it.each(['0', 'O', 'I', 'l'])(
    'rejects the Bitcoin-excluded char %s',
    (ch) => {
      expect(() => decodeMultibaseBase58('z' + ch))
        .toThrow(/invalid base58 char/);
    },
  );

  it('rejects a non-alphabet symbol', () => {
    expect(() => decodeMultibaseBase58('z!')).toThrow(/invalid/);
  });
});

describe('round-trip: encode then decode', () => {
  const cases: Array<{ name: string; bytes: Uint8Array }> = [
    { name: 'single byte', bytes: new Uint8Array([0x42]) },
    { name: 'short payload', bytes: new Uint8Array([1, 2, 3, 4, 5]) },
    { name: 'leading-zero payload',
      bytes: new Uint8Array([0, 0, 1, 2, 3]) },
    { name: 'Ed25519-sized raw key (32 bytes)',
      bytes: hex(
        'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
      ) },
    { name: 'Ed25519 multikey (34 bytes, 0xed01 prefix)',
      bytes: hex(
        'ed01' +
        'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
      ) },
    { name: 'Ed25519 signature size (64 bytes)',
      bytes: hex('00'.repeat(64)) },
  ];

  for (const { name, bytes } of cases) {
    it(name, () => {
      const encoded = encodeMultibaseBase58(bytes);
      const decoded = decodeMultibaseBase58(encoded);
      expect(decoded).toEqual(bytes);
    });
  }

  it('encodes random byte arrays losslessly', () => {
    for (let trial = 0; trial < 16; trial++) {
      const len = (trial * 7) % 37;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = (trial * 31 + i * 17) & 0xff;
      }
      const decoded = decodeMultibaseBase58(
        encodeMultibaseBase58(bytes),
      );
      expect(decoded).toEqual(bytes);
    }
  });
});

describe('Ed25519 Multikey prefix invariant', () => {
  // The Multikey multicodec varint for Ed25519 is the
  // two bytes 0xed 0x01. In base58btc, every 34-byte
  // payload starting with this prefix encodes to a
  // string with the well-known "z6Mk" lead -- this is
  // the visual marker DID/VC tooling uses to recognise
  // Ed25519 keys. The verifier asserts the same two-
  // byte prefix on decode.
  it('every Ed25519 multikey encodes to a z6Mk... string', () => {
    // Sample a few different raw-key bytes; the prefix
    // determines the first four characters regardless
    // of payload.
    const samples: Uint8Array[] = [
      hex('ed01' + '00'.repeat(32)),
      hex('ed01' + 'ff'.repeat(32)),
      hex(
        'ed01' +
        'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af0' +
        '21a68f707511a',
      ),
    ];
    for (const bytes of samples) {
      expect(encodeMultibaseBase58(bytes).startsWith('z6Mk'))
        .toBe(true);
    }
  });

  it('decoded Ed25519 multikey bytes preserve the prefix', () => {
    const raw = hex(
      'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    );
    const multikey = new Uint8Array(34);
    multikey[0] = 0xed;
    multikey[1] = 0x01;
    multikey.set(raw, 2);
    const decoded = decodeMultibaseBase58(
      encodeMultibaseBase58(multikey),
    );
    expect(decoded.length).toBe(34);
    expect(decoded[0]).toBe(0xed);
    expect(decoded[1]).toBe(0x01);
    expect(decoded.slice(2)).toEqual(raw);
  });
});

describe('does not mutate caller buffer', () => {
  it('encode leaves input intact', () => {
    const input = new Uint8Array([0, 0, 1, 2, 3]);
    const snapshot = Uint8Array.from(input);
    encodeMultibaseBase58(input);
    expect(input).toEqual(snapshot);
  });
});
