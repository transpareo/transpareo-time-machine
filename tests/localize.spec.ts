/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * foldLocale collapses the wire's localized shapes to the
 * model's `string | { locale: text }`. Under EN 18223 every
 * localized literal (names, category, descriptions,
 * substance names) ships as the JSON-LD expanded array form
 * `[{ '@value', '@language' }, ...]`; the renderer folds it
 * at the wire boundary so tx() and the helpers see one shape.
 */

import { describe, it, expect } from 'vitest';
import { foldLocale, isLanguageArray, tx } from '../src/types';

describe('foldLocale', () => {
  it('folds the expanded array form to a locale hash', () => {
    const v = [
      { '@value': 'Zwei Jahre', '@language': 'de' },
      { '@value': 'Two years', '@language': 'en' },
    ];
    expect(foldLocale(v)).toEqual({ de: 'Zwei Jahre', en: 'Two years' });
  });

  it('passes a plain string through', () => {
    expect(foldLocale('VOL-2000')).toBe('VOL-2000');
  });

  it('passes an existing locale hash through', () => {
    expect(foldLocale({ en: 'Care', de: 'Pflege' }))
      .toEqual({ en: 'Care', de: 'Pflege' });
  });

  it('degrades null / undefined / unexpected shapes to an empty string', () => {
    expect(foldLocale(undefined)).toBe('');
    expect(foldLocale(null)).toBe('');
    expect(foldLocale(42)).toBe('');
  });

  it('renders through tx after folding (locale, then fallback)', () => {
    const folded = foldLocale([
      { '@value': 'Hallo', '@language': 'de' },
      { '@value': 'Hello', '@language': 'en' },
    ]);
    expect(tx(folded, 'de')).toBe('Hallo');
    expect(tx(folded, 'fr')).toBe('Hello');
  });

  it('tx renders a typed literal as its @value, explicitly ' +
      'rather than by hash-key order', () => {
    // Structured-composition cells carry the signed typed-
    // literal form; when one reaches tx (a list row whose
    // first cell is numeric) it must render its lexical
    // value, never fall into the locale lookup.
    const typed = { '@value': '3.5', '@type': 'xsd:decimal' };
    expect(tx(typed as never, 'de')).toBe('3.5');
  });
});

describe('isLanguageArray', () => {
  it('accepts a well-formed expanded array', () => {
    expect(isLanguageArray([{ '@value': 'x', '@language': 'en' }])).toBe(true);
  });

  it('rejects a locale hash, a plain list, and an empty array', () => {
    expect(isLanguageArray({ en: 'x' })).toBe(false);
    expect(isLanguageArray(['a', 'b'])).toBe(false);
    expect(isLanguageArray([{ en: 'x' }])).toBe(false);
    expect(isLanguageArray([])).toBe(false);
  });
});
