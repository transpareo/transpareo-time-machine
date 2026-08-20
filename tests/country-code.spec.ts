/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Country values ride the wire as ISO 3166-1 alpha-2 codes
 * inside a typed literal, so a regulator or an aggregator
 * gets the code and the reader gets a country name in their
 * own language. The code stays the signed value; tx() does
 * the naming at render time, which is what keeps a locale
 * switch honest.
 *
 * DT below is the wire contract, spelled out rather than
 * imported: the datatype is what a second implementation
 * has to match byte for byte, so a test that reads it from
 * the same constant the code reads would agree with any
 * value at all.
 *
 * These cases pin the resolution, both fallbacks (an
 * unassigned code, a platform with no region data), and the
 * manufacturer address, whose country arrives code-only.
 */

import { describe, expect, it } from 'vitest';
import { tx, regionLiteral, isRegionLiteral } from '../src/types';
import { toRenderModel } from '../src/host';
import type { SignedSnapshot } from '../src/archive';

const DT = 'https://transpareo.com/vocab/transpareo/v1#iso3166-1-alpha2';
const PT = { '@value': 'PT', '@type': DT };

describe('tx: country codes', () => {
  it('names the country in the viewer locale', () => {
    expect(tx(PT, 'en')).toBe('Portugal');
    expect(tx(PT, 'de')).toBe('Portugal');
    expect(tx(PT, 'ro')).toBe('Portugalia');
    expect(tx(PT, 'ja')).toBe('ポルトガル');
  });

  it('names a second country, so the code is really read', () => {
    const it_ = { '@value': 'IT', '@type': DT };
    expect(tx(it_, 'en')).toBe('Italy');
    expect(tx(it_, 'de')).toBe('Italien');
  });

  // ZZ is the ISO placeholder for "unknown". CLDR names it
  // "Unknown Region", which reads like an answer; the code
  // is the honest one, and it is what the bytes carry.
  it('falls back to the code for the unknown-region placeholder', () => {
    const zz = { '@value': 'ZZ', '@type': DT };
    expect(tx(zz, 'en')).toBe('ZZ');
    expect(tx(zz, 'de')).toBe('ZZ');
  });

  // An alpha-3 code is not what the datatype promises;
  // Intl rejects it and the value renders verbatim rather
  // than blanking the tile.
  it('falls back to the code when Intl rejects it', () => {
    const prt = { '@value': 'PRT', '@type': DT };
    expect(tx(prt, 'en')).toBe('PRT');
  });

  // Intl hands a lower-case code straight back instead of
  // case-folding it, which would render "pt" on a tile.
  it('names the country for a lower-case code', () => {
    const pt = { '@value': 'pt', '@type': DT };
    expect(tx(pt, 'en')).toBe('Portugal');
  });

  // A publisher whose stored value is a country name rather
  // than a code can type it as one by mistake. The literal
  // then makes a false claim, but the reader still gets the
  // name: the fallback prints the document's own lexical
  // form, so a mistyped row reads as it did before it was
  // typed at all.
  it('renders a name that was mistyped as a code', () => {
    const bad = { '@value': 'Germany', '@type': DT };
    expect(tx(bad, 'de')).toBe('Germany');
  });

  it('falls back to the code when the platform has no Intl data', () => {
    const real = Intl.DisplayNames;
    try {
      (Intl as { DisplayNames?: unknown }).DisplayNames = undefined;

      // A locale no other case in this file touches: the
      // resolver caches one instance per locale, so a warm
      // entry would mask the missing constructor.
      expect(tx(PT, 'sq')).toBe('PT');
    } finally {
      (Intl as { DisplayNames?: unknown }).DisplayNames = real;
    }
  });

  // Guards the branch order in tx(): a generic typed literal
  // still renders its lexical value, unchanged.
  it('leaves a non-country typed literal alone', () => {
    const dec = { '@value': '250.0', '@type': 'xsd:decimal' };
    expect(tx(dec, 'de')).toBe('250.0');
  });

  it('leaves a plain locale hash alone', () => {
    expect(tx({ en: 'PT', de: 'PT' }, 'en')).toBe('PT');
  });
});

describe('regionLiteral / isRegionLiteral', () => {
  it('wraps a code and recognises the wrapper', () => {
    const lit = regionLiteral('PT');
    expect(lit).toEqual(PT);
    expect(isRegionLiteral(lit)).toBe(true);
  });

  it('passes undefined through so a caller can chain it', () => {
    expect(regionLiteral(undefined)).toBeUndefined();
    expect(regionLiteral('')).toBeUndefined();
  });

  it('rejects everything that is not the literal', () => {
    expect(isRegionLiteral('PT')).toBe(false);
    expect(isRegionLiteral({ en: 'Portugal' })).toBe(false);
    expect(isRegionLiteral([PT])).toBe(false);
    expect(isRegionLiteral(null)).toBe(false);
    expect(isRegionLiteral({ '@type': DT })).toBe(false);
    expect(isRegionLiteral({ '@value': 'PT', '@type': 'xsd:string' }))
      .toBe(false);
  });
});

// The manufacturer block is the one place the wire models a
// country as a bare sibling field rather than a value, and
// it is code-only in practice, so the address strip printed
// "PT" until the adapter wrapped it.
describe('toRenderModel: manufacturer country', () => {
  const model = (manufacturer: Record<string, unknown>): SignedSnapshot =>
    ({
      version: 1,
      publishedAt: '2026-01-01T00:00:00Z',
      dppStatus: 'inUse',
      issuer: { '@type': 'Organization', name: 'I', did: 'did:web:i' },
      platform: { '@type': 'Organization', name: 'P', did: 'did:web:p' },
      product: {
        '@type': 'Product', name: { en: 'X' }, brand: 'B',
        properties: [], manufacturer,
      },
      proof: [],
    } as unknown as SignedSnapshot);

  it('wraps a code-only country so it resolves per locale', () => {
    const m = toRenderModel(model({ name: 'N', countryCode: 'PT' }))
      .product.manufacturer;
    expect(m.country).toEqual(PT);
    expect(tx(m.country, 'de')).toBe('Portugal');
  });

  it('prefers a spelled-out country over the code', () => {
    const m = toRenderModel(
      model({ name: 'N', country: 'Portugal', countryCode: 'PT' }),
    ).product.manufacturer;
    expect(m.country).toBe('Portugal');
  });

  it('leaves the country empty when the wire carries neither', () => {
    const m = toRenderModel(model({ name: 'N' })).product.manufacturer;
    expect(m.country).toBe('');
    expect(tx(m.country, 'en')).toBe('');
  });
});
