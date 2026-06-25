/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * t()'s fallback chain (active catalog -> English -> the
 * key itself) and placeholder substitution, plus
 * detectLocale's pick order (stored choice -> browser
 * preference with region stripping -> first available).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { t, englishLabels, type Labels } from '../src/i18n/labels';
import { detectLocale, setHostLocale } from '../src/i18n';

describe('t', () => {
  it('reads the active catalog first', () => {
    const labels = { 'gallery.close': 'Schließen' } as unknown as Labels;
    expect(t(labels, 'gallery.close')).toBe('Schließen');
  });

  it('falls back to English for a missing key', () => {
    const labels = {} as Labels;
    expect(t(labels, 'gallery.close'))
      .toBe(englishLabels['gallery.close']);
  });

  it('falls back to the key itself when English misses too', () => {
    const labels = {} as Labels;
    expect(t(labels, 'no.such.key' as never)).toBe('no.such.key');
  });

  it('substitutes {placeholders} from vars', () => {
    const labels = {
      'cryptoProof.versionOf': 'Version {current} von {total}',
    } as unknown as Labels;
    expect(t(labels, 'cryptoProof.versionOf', { current: 2, total: 6 }))
      .toBe('Version 2 von 6');
  });

  it('leaves an unknown placeholder literal', () => {
    const labels = {
      'boot.loadError': 'Fehler: {message}',
    } as unknown as Labels;
    expect(t(labels, 'boot.loadError', {})).toBe('Fehler: {message}');
  });
});

describe('detectLocale', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setHostLocale(null);
  });

  function stubBrowser(
    languages: string[], stored: string | null = null,
  ): void {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => stored,
        setItem: () => undefined,
      },
    });
    vi.stubGlobal('navigator', { languages, language: languages[0] });
  }

  it('returns en when no locales are available', () => {
    expect(detectLocale(undefined)).toBe('en');
    expect(detectLocale([])).toBe('en');
  });

  it('prefers the stored prior pick', () => {
    stubBrowser(['fr-FR'], 'de');
    expect(detectLocale(['en', 'de', 'fr'])).toBe('de');
  });

  it('ignores a stored pick that is not available', () => {
    stubBrowser(['fr-FR'], 'ja');
    expect(detectLocale(['en', 'fr'])).toBe('fr');
  });

  it('matches browser preference with the region stripped', () => {
    stubBrowser(['de-AT', 'en-US']);
    expect(detectLocale(['en', 'de'])).toBe('de');
  });

  it('falls back to the first available locale', () => {
    stubBrowser(['ja-JP']);
    expect(detectLocale(['de', 'en'])).toBe('de');
  });

  it('prefers the host lang over the browser preference', () => {
    stubBrowser(['fr-FR']);
    setHostLocale('de');
    expect(detectLocale(['en', 'de', 'fr'])).toBe('de');
  });

  it('lets a stored pick win over the host lang', () => {
    stubBrowser(['fr-FR'], 'fr');
    setHostLocale('de');
    expect(detectLocale(['en', 'de', 'fr'])).toBe('fr');
  });

  it('ignores a host lang the data does not offer', () => {
    stubBrowser(['en-US']);
    setHostLocale('xx');
    expect(detectLocale(['en', 'de'])).toBe('en');
  });

  it('strips the region from the host lang', () => {
    stubBrowser(['fr-FR']);
    setHostLocale('de-AT');
    expect(detectLocale(['en', 'de'])).toBe('de');
  });
});
