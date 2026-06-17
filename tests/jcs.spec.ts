/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * RFC 8785 (JSON Canonicalization Scheme) coverage for
 * the canonicalizer at src/crypto/jcs.ts. The exact byte
 * output of this module is the input both the seed signer
 * and the in-browser verifier hash, so any drift here
 * silently breaks every signature in the wild. Tests are
 * organised around the failure modes that would not be
 * caught by `tsc`.
 */

import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/crypto/jcs';

describe('canonicalize: primitives', () => {
  it('serializes null', () => {
    expect(canonicalize(null)).toBe('null');
  });

  it('serializes booleans', () => {
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
  });

  it('serializes integers', () => {
    expect(canonicalize(0)).toBe('0');
    expect(canonicalize(1)).toBe('1');
    expect(canonicalize(-1)).toBe('-1');
    expect(canonicalize(42)).toBe('42');
  });

  it('serializes floats in ECMA-262 ToString form', () => {
    // RFC 8785 step 3.2.2 defers to ECMA-262, which is
    // what JSON.stringify already produces.
    expect(canonicalize(1.5)).toBe('1.5');
    expect(canonicalize(0.1)).toBe('0.1');
    expect(canonicalize(1e3)).toBe('1000');
    expect(canonicalize(1.0)).toBe('1');
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalize(NaN)).toThrow(/non-finite/);
    expect(() => canonicalize(Infinity)).toThrow(/non-finite/);
    expect(() => canonicalize(-Infinity)).toThrow(/non-finite/);
  });

  it('serializes ASCII strings via JSON.stringify', () => {
    expect(canonicalize('')).toBe('""');
    expect(canonicalize('a')).toBe('"a"');
    expect(canonicalize('hello world')).toBe('"hello world"');
  });

  it('escapes control chars and quotes', () => {
    expect(canonicalize('a"b')).toBe('"a\\"b"');
    expect(canonicalize('a\nb')).toBe('"a\\nb"');
    expect(canonicalize('a\\b')).toBe('"a\\\\b"');
  });

  it('passes unicode strings through', () => {
    // Non-ASCII codepoints are emitted as themselves
    // (JSON.stringify does not escape them by default,
    // which is RFC 8785 compliant).
    expect(canonicalize('héllo')).toBe('"héllo"');
    expect(canonicalize('日本語')).toBe('"日本語"');
    expect(canonicalize('🦀')).toBe('"🦀"');
  });
});

describe('canonicalize: arrays', () => {
  it('serializes an empty array', () => {
    expect(canonicalize([])).toBe('[]');
  });

  it('preserves array order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('separates items with a single comma, no whitespace', () => {
    expect(canonicalize([1, 2, 3])).toBe('[1,2,3]');
  });

  it('rejects undefined in array position', () => {
    expect(() => canonicalize([1, undefined, 3]))
      .toThrow(/undefined in array/);
  });

  it('canonicalizes nested values inside arrays', () => {
    expect(canonicalize([{ b: 1, a: 2 }]))
      .toBe('[{"a":2,"b":1}]');
  });
});

describe('canonicalize: objects', () => {
  it('serializes an empty object', () => {
    expect(canonicalize({})).toBe('{}');
  });

  it('sorts keys lexicographically by UTF-16 code unit', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: 1, a: 2, m: 3 }))
      .toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts numeric-looking keys as strings, not numbers', () => {
    // String "10" sorts before "2" by UTF-16 code unit,
    // because '1' (0x31) precedes '2' (0x32).
    expect(canonicalize({ '2': 'b', '10': 'a' }))
      .toBe('{"10":"a","2":"b"}');
  });

  it('orders uppercase before lowercase', () => {
    // 'A' (0x41) precedes 'a' (0x61). RFC 8785 step
    // 3.2.3 is explicit about UTF-16 code unit order.
    expect(canonicalize({ a: 1, A: 2 })).toBe('{"A":2,"a":1}');
  });

  it('orders non-BMP keys by surrogate pair', () => {
    // RFC 8785 specifies UTF-16 code unit comparison, so
    // a key starting with the high-surrogate of an
    // astral character (U+D83E for 🦀 = U+1F980) sorts
    // after BMP chars below 0xD800.
    const out = canonicalize({ '🦀': 1, 'z': 2 });

    // 'z' is 0x7A; high surrogate is 0xD83E -> 'z'
    // comes first.
    expect(out).toBe('{"z":2,"🦀":1}');
  });

  it('skips undefined object values', () => {
    expect(canonicalize({ a: 1, b: undefined, c: 3 }))
      .toBe('{"a":1,"c":3}');
  });

  it('separates pairs with a single colon and comma', () => {
    expect(canonicalize({ a: 1, b: 2 }))
      .toBe('{"a":1,"b":2}');
  });

  it('canonicalizes nested objects recursively', () => {
    const nested = {
      outer: { z: 1, a: { y: 1, b: 2 } },
      a: 0,
    };
    expect(canonicalize(nested))
      .toBe('{"a":0,"outer":{"a":{"b":2,"y":1},"z":1}}');
  });
});

describe('canonicalize: snapshot proof invariant', () => {
  // The renderer's verifier strips the `proof` field
  // and JCS-canonicalizes the rest. The signer does the
  // same on its side. Object-spread order does not
  // affect output bytes -- this is the invariant the
  // whole signature scheme rests on.
  it('produces the same bytes regardless of source key order', () => {
    const a = { version: 1, publishedAt: '2026-01-01T00:00:00Z' };
    const b = { publishedAt: '2026-01-01T00:00:00Z', version: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('strips the proof field via caller spread before canonicalization', () => {
    const snapshot = {
      version: 1,
      publishedAt: '2026-01-01T00:00:00Z',
      proof: [{ proofValue: 'tampered' }],
    };
    const { proof: _proof, ...body } = snapshot;
    expect(canonicalize(body))
      .toBe('{"publishedAt":"2026-01-01T00:00:00Z","version":1}');
  });
});

describe('canonicalize: invalid input types', () => {
  it('throws on bigint', () => {
    expect(() => canonicalize(BigInt(1))).toThrow(/unsupported/);
  });

  it('throws on symbol', () => {
    expect(() => canonicalize(Symbol('x'))).toThrow(/unsupported/);
  });

  it('throws on function', () => {
    expect(() => canonicalize(() => 1)).toThrow(/unsupported/);
  });
});
