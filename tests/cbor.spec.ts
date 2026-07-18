/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Verify-only CBOR decoder coverage for src/crypto/cbor.ts.
 * Positive cases are the canonical RFC 8949 Appendix A
 * vectors for the supported subset (uint, byte/text
 * string, array, integer-keyed map, tag), plus the two
 * ecdsa-sd-2023 proofValue envelope shapes. Negative
 * cases assert the decoder fails closed on everything
 * outside that subset.
 */

import { describe, expect, it } from 'vitest';
import { decodeCbor, type CborTag } from '../src/crypto/cbor';

function hex(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('decodeCbor: unsigned integers (RFC 8949 A.1)', () => {
  const cases: Array<[string, number]> = [
    ['00', 0],
    ['01', 1],
    ['0a', 10],
    ['17', 23],
    ['1818', 24],
    ['1864', 100],
    ['1903e8', 1000],
    ['1a000f4240', 1000000],
    ['1b0000000100000000', 4294967296],
  ];
  for (const [h, n] of cases) {
    it(`0x${h} -> ${n}`, () => {
      expect(decodeCbor(hex(h))).toBe(n);
    });
  }
});

describe('decodeCbor: byte and text strings', () => {
  it('empty byte string', () => {
    expect(decodeCbor(hex('40'))).toEqual(new Uint8Array(0));
  });

  it('four-byte string', () => {
    expect(decodeCbor(hex('4401020304')))
      .toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('empty text string', () => {
    expect(decodeCbor(hex('60'))).toBe('');
  });

  it('text string "IETF"', () => {
    expect(decodeCbor(hex('6449455446'))).toBe('IETF');
  });

  it('rejects invalid utf-8 in a text string', () => {
    // 0x61 = text of length 1, 0xff is not valid utf-8.
    expect(() => decodeCbor(hex('61ff'))).toThrow();
  });
});

describe('decodeCbor: arrays and maps', () => {
  it('empty array', () => {
    expect(decodeCbor(hex('80'))).toEqual([]);
  });

  it('flat array [1,2,3]', () => {
    expect(decodeCbor(hex('83010203'))).toEqual([1, 2, 3]);
  });

  it('nested array [1,[2,3],[4,5]]', () => {
    expect(decodeCbor(hex('8301820203820405')))
      .toEqual([1, [2, 3], [4, 5]]);
  });

  it('empty map', () => {
    expect(decodeCbor(hex('a0'))).toEqual(new Map());
  });

  it('integer-keyed map {1:2, 3:4}', () => {
    expect(decodeCbor(hex('a201020304')))
      .toEqual(new Map([[1, 2], [3, 4]]));
  });

  it('rejects a non-integer map key', () => {
    // 0xa1 { "a": 1 } -> text key is out of subset.
    expect(() => decodeCbor(hex('a1616101')))
      .toThrow(/map key is not an integer/);
  });

  it('rejects a duplicate map key', () => {
    // 0xa2 { 1:2, 1:3 }
    expect(() => decodeCbor(hex('a201020103')))
      .toThrow(/duplicate CBOR map key/);
  });
});

describe('decodeCbor: tags and the ecdsa-sd envelopes', () => {
  it('decodes the 2-byte tag 0xd95d01 (derived proof)', () => {
    // tag(23809) [ 1 ]
    const v = decodeCbor(hex('d95d01' + '8101')) as CborTag;
    expect(v.tag).toBe(0x5d01);
    expect(v.value).toEqual([1]);
  });

  it('decodes a base-proof shaped envelope', () => {
    // tag(0xd95d00) [ h'aa', h'bb', h'cc', [h'dd'], ["/x"] ]
    const v = decodeCbor(
      hex('d95d00' + '85' + '41aa' + '41bb' + '41cc'
        + '81' + '41dd' + '81' + '62' + '2f78'),
    ) as CborTag;
    expect(v.tag).toBe(0x5d00);
    const arr = v.value as unknown[];
    expect(arr[0]).toEqual(new Uint8Array([0xaa]));
    expect(arr[3]).toEqual([new Uint8Array([0xdd])]);
    expect(arr[4]).toEqual(['/x']);
  });

  it('decodes a derived-proof shaped envelope with a label map', () => {
    // tag(0xd95d01) [ h'aa', h'bb', [h'cc'], {0:1, 2:3}, [0] ]
    const v = decodeCbor(
      hex('d95d01' + '85' + '41aa' + '41bb'
        + '81' + '41cc' + 'a2' + '0001' + '0203' + '81' + '00'),
    ) as CborTag;
    expect(v.tag).toBe(0x5d01);
    const arr = v.value as unknown[];
    expect(arr[2]).toEqual([new Uint8Array([0xcc])]);
    expect(arr[3]).toEqual(new Map([[0, 1], [2, 3]]));
    expect(arr[4]).toEqual([0]);
  });
});

describe('decodeCbor: fails closed on the unsupported subset', () => {
  it('rejects a negative integer (major type 1)', () => {
    expect(() => decodeCbor(hex('20')))
      .toThrow(/unsupported CBOR major type 1/);
  });

  it('rejects a float (major type 7)', () => {
    expect(() => decodeCbor(hex('fb3ff0000000000000')))
      .toThrow(/unsupported CBOR major type 7/);
  });

  it.each(['f4', 'f5', 'f6'])(
    'rejects the simple value 0x%s (false/true/null)',
    (h) => {
      expect(() => decodeCbor(hex(h)))
        .toThrow(/unsupported CBOR major type 7/);
    },
  );

  it('rejects an indefinite-length array', () => {
    expect(() => decodeCbor(hex('9f0102ff')))
      .toThrow(/unsupported CBOR additional-info 31/);
  });

  it('rejects an indefinite-length byte string', () => {
    expect(() => decodeCbor(hex('5f42010243030405ff')))
      .toThrow(/unsupported CBOR additional-info 31/);
  });

  it('rejects a 64-bit integer beyond the safe range', () => {
    expect(() => decodeCbor(hex('1bffffffffffffffff')))
      .toThrow(/exceeds safe range/);
  });
});

describe('decodeCbor: rejects framing errors', () => {
  it('rejects trailing bytes after a complete item', () => {
    expect(() => decodeCbor(hex('0000')))
      .toThrow(/trailing bytes/);
  });

  it('rejects a truncated argument', () => {
    // 0x18 announces a 1-byte argument that is not present.
    expect(() => decodeCbor(hex('18'))).toThrow(/unexpected end/);
  });

  it('rejects a truncated byte string', () => {
    // announces 4 bytes, supplies 2.
    expect(() => decodeCbor(hex('440102'))).toThrow(/unexpected end/);
  });

  it('rejects a truncated array element', () => {
    // array of 2, only 1 present.
    expect(() => decodeCbor(hex('8201'))).toThrow(/unexpected end/);
  });
});
