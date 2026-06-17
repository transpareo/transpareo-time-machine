/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Coverage for the property-value classifier at
 * src/property-classify.ts. The signed snapshot carries
 * raw values with no render-hint, so this module decides
 * the presentation surface from the value's shape and a
 * length gate. The cases below pin the shape boundaries
 * and the accordion-grouping pass.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyWireValue,
  bridgeLongTextGroups,
  LONG_TEXT_GATE,
} from '../src/property-classify';
import type { PropertyValueKind } from '../src/types';

describe('classifyWireValue: scalars', () => {
  it('keeps the raw number (for locale formatting) and the unit', () => {
    const k = classifyWireValue(12.4, 'kg CO2e');
    expect(k).toEqual({
      type: 'scalar', value: '12.4', numeric: 12.4, unit: 'kg CO2e',
    });
  });

  it('classifies an integer with no unit', () => {
    expect(classifyWireValue(87, undefined)).toEqual({
      type: 'scalar', value: '87', numeric: 87,
    });
  });

  it('leaves a numeric-looking string as text (no numeric field)', () => {
    // Only bare wire numbers format; "2048 Wh" stays verbatim.
    expect(classifyWireValue('2048 Wh', undefined)).toEqual({
      type: 'scalar', value: '2048 Wh',
    });
  });

  it('treats a short string as a scalar', () => {
    expect(classifyWireValue('SUP-4471', undefined)).toEqual({
      type: 'scalar', value: 'SUP-4471',
    });
  });

  it('treats a short locale-hash as a scalar', () => {
    const v = { en: 'Compliant', de: 'Konform' };
    expect(classifyWireValue(v, undefined)).toEqual({ type: 'scalar', value: v });
  });
});

describe('classifyWireValue: language-array scalars', () => {
  it('folds the JSON-LD expanded form to a locale-hash scalar', () => {
    const v = [
      { '@value': 'Two-year warranty', '@language': 'en' },
      { '@value': 'Zwei Jahre Garantie', '@language': 'de' },
    ];
    expect(classifyWireValue(v, undefined)).toEqual({
      type: 'scalar',
      value: { en: 'Two-year warranty', de: 'Zwei Jahre Garantie' },
    });
  });

  it('gates a long language-array to longText on the longest locale', () => {
    const v = [
      { '@value': 'Short', '@language': 'en' },
      { '@value': 'y'.repeat(LONG_TEXT_GATE + 5), '@language': 'de' },
    ];
    expect(classifyWireValue(v, undefined)).toEqual({
      type: 'longText',
      body: { en: 'Short', de: 'y'.repeat(LONG_TEXT_GATE + 5) },
    });
  });

  it('does not mistake a single-locale entry for a list', () => {
    const v = [{ '@value': 'Compliant', '@language': 'en' }];
    expect(classifyWireValue(v, undefined)).toEqual({
      type: 'scalar', value: { en: 'Compliant' },
    });
  });
});

describe('classifyWireValue: scalar vs longText gate', () => {
  it('keeps a string at the gate length as a scalar', () => {
    const v = 'x'.repeat(LONG_TEXT_GATE);
    expect(classifyWireValue(v, undefined).type).toBe('scalar');
  });

  it('promotes a string past the gate to longText', () => {
    const v = 'x'.repeat(LONG_TEXT_GATE + 1);
    expect(classifyWireValue(v, undefined)).toEqual({ type: 'longText', body: v });
  });

  it('promotes a value with a line break regardless of length', () => {
    expect(classifyWireValue('a\nb', undefined).type).toBe('longText');
  });

  it('gates on the longest locale, not the active one', () => {
    // Short in en, long in de: the whole value is longText
    // so the surface stays stable across a language switch.
    const v = { en: 'Short', de: 'y'.repeat(LONG_TEXT_GATE + 5) };
    expect(classifyWireValue(v, undefined)).toEqual({ type: 'longText', body: v });
  });
});

describe('classifyWireValue: lists', () => {
  it('classifies an array of plain strings as a list', () => {
    const k = classifyWireValue(['XS', 'S', 'M'], undefined);
    expect(k).toEqual({ type: 'list', items: ['XS', 'S', 'M'] });
  });

  it('classifies an array of locale-hashes as a list', () => {
    const items = [{ en: 'Daily wear', de: 'Alltag' }];
    expect(classifyWireValue(items, undefined)).toEqual({ type: 'list', items });
  });
});

describe('classifyWireValue: composition', () => {
  it('maps substance rows to composition entries', () => {
    const k = classifyWireValue([
      {
        '@type': 'Substance',
        name: { en: 'Merino wool' },
        value: 62,
        unitCode: 'P1',
        countryCode: 'AU',
        rating: 'veryGood',
        libraryRef: 'https://cdn.example/merino.jsonld',
      },
      {
        '@type': 'Substance',
        name: { en: 'Recycled polyester' },
        value: 38,
        unitCode: 'P1',
        rating: 'neutral',
      },
    ], '%');
    expect(k).toEqual({
      type: 'composition',
      unit: '%',
      entries: [
        {
          name: { en: 'Merino wool' },
          percent: 62,
          countryCode: 'AU',
          rating: 'veryGood',
          libraryRef: 'https://cdn.example/merino.jsonld',
        },
        { name: { en: 'Recycled polyester' }, percent: 38, rating: 'neutral' },
      ],
    });
  });

  it('detects a substance by its own value key without @type', () => {
    const k = classifyWireValue(
      [{ name: { en: 'Cotton' }, value: 100 }], undefined,
    );
    expect(k.type).toBe('composition');
  });

  it('normalises a snake_case rating token on a substance', () => {
    const k = classifyWireValue(
      [{ '@type': 'Substance', name: { en: 'X' }, value: 50, rating: 'very_good' }],
      undefined,
    ) as Extract<PropertyValueKind, { type: 'composition' }>;
    expect(k.entries[0].rating).toBe('veryGood');
  });
});

describe('classifyWireValue: malformed', () => {
  it('degrades an unexpected shape to a blank scalar', () => {
    expect(classifyWireValue(null, undefined)).toEqual({ type: 'scalar', value: '' });
    expect(classifyWireValue(true, undefined)).toEqual({ type: 'scalar', value: '' });
  });
});

describe('bridgeLongTextGroups', () => {
  const scalar = (v: string): PropertyValueKind => ({ type: 'scalar', value: v });
  const long = (v: string): PropertyValueKind => ({ type: 'longText', body: v });
  const list: PropertyValueKind = { type: 'list', items: ['a'] };

  it('promotes a lone scalar flanked by accordions', () => {
    const out = bridgeLongTextGroups([long('a'), scalar('b'), long('c')]);
    expect(out.map((k) => k.type)).toEqual(['longText', 'longText', 'longText']);
  });

  it('leaves a two-scalar gap as tiles', () => {
    const out = bridgeLongTextGroups([
      long('a'), scalar('b'), scalar('c'), long('d'),
    ]);
    expect(out.map((k) => k.type)).toEqual([
      'longText', 'scalar', 'scalar', 'longText',
    ]);
  });

  it('does not bridge an edge scalar', () => {
    const out = bridgeLongTextGroups([scalar('a'), long('b')]);
    expect(out.map((k) => k.type)).toEqual(['scalar', 'longText']);
  });

  it('only bridges when both neighbours are accordions', () => {
    const out = bridgeLongTextGroups([long('a'), scalar('b'), list]);
    expect(out.map((k) => k.type)).toEqual(['longText', 'scalar', 'list']);
  });

  it('returns the same reference when nothing moves', () => {
    const input = [scalar('a'), scalar('b')];
    expect(bridgeLongTextGroups(input)).toBe(input);
  });
});
