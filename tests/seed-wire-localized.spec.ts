/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How the seed writes a localized value onto the wire. EN
 * 18223 carries product / property / substance names and
 * values in the JSON-LD expanded form, so a locale hash
 * leaves as `[{ '@value', '@language' }, ...]`, and a list
 * of them flattens to one tagged entry per value.
 *
 * The flattening order is load-bearing: JSON-LD reads
 * multiple values as an unordered set, so entry order per
 * locale is the only thing pairing one locale's second
 * value with another's. src/property-classify.ts reads it
 * back out on that basis.
 *
 * Values that are not locale hashes (plain strings, typed
 * country literals) pass through untouched; converting
 * those would change what the signature covers for no gain.
 */

import { describe, it, expect } from 'vitest';
import { toWireLocalized } from '../scripts/seed/emit-artefacts.ts';

const COUNTRY = 'https://transpareo.com/vocab/transpareo/v1#iso3166-1-alpha2';

describe('toWireLocalized', () => {
  it('expands a locale hash, locale-sorted', () => {
    const v = { en: 'Two-year warranty', de: 'Zwei Jahre Garantie' };
    expect(toWireLocalized(v)).toEqual([
      { '@value': 'Zwei Jahre Garantie', '@language': 'de' },
      { '@value': 'Two-year warranty', '@language': 'en' },
    ]);
  });

  it('flattens a list of hashes entry by entry', () => {
    const v = [
      { en: 'Daily wear', de: 'Alltagskleidung' },
      { en: 'Casual', de: 'Casual' },
    ];
    expect(toWireLocalized(v)).toEqual([
      { '@value': 'Alltagskleidung', '@language': 'de' },
      { '@value': 'Daily wear', '@language': 'en' },
      { '@value': 'Casual', '@language': 'de' },
      { '@value': 'Casual', '@language': 'en' },
    ]);
  });

  // Read back per locale, the entries keep the order they
  // were written in, which is what lets the renderer put
  // one locale's second value on the same row as another's.
  it('keeps each locale in entry order', () => {
    const v = [
      { en: 'Daily wear', de: 'Alltagskleidung' },
      { en: 'Casual', de: 'Casual' },
      { en: 'Layering', de: 'Zum Kombinieren' },
    ];
    const out = toWireLocalized(v) as ReadonlyArray<Record<string, string>>;
    const perLocale = (lang: string): string[] => out
      .filter((e) => e['@language'] === lang)
      .map((e) => e['@value']);
    expect(perLocale('de')).toEqual([
      'Alltagskleidung', 'Casual', 'Zum Kombinieren',
    ]);
    expect(perLocale('en')).toEqual(['Daily wear', 'Casual', 'Layering']);
  });

  it('passes a plain string list through', () => {
    const v = ['GOTS Organic', 'Fair Trade'];
    expect(toWireLocalized(v)).toBe(v);
  });

  it('passes typed country literals through', () => {
    const v = [{ '@value': 'PT', '@type': COUNTRY }];
    expect(toWireLocalized(v)).toBe(v);
  });

  it('passes a string and an empty list through', () => {
    expect(toWireLocalized('Cotton')).toBe('Cotton');
    const empty: unknown[] = [];
    expect(toWireLocalized(empty)).toBe(empty);
  });
});
