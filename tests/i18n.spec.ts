/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * t()'s fallback chain (active catalog -> English -> the
 * key itself) and placeholder substitution, plus
 * detectLocale's pick order (a stored pick made under this
 * same host `lang` -> an embedder's `lang` naming an
 * available locale -> that pick made in another context ->
 * browser preference with region stripping -> first
 * available), and the stamp pickLocale leaves for it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  t, englishLabels, bundledLocales, type Labels,
} from '../src/i18n/labels';
import {
  detectLocale, setHostLocale, pickLocale, nativeName, localizedName,
  NATIVE_NAMES,
} from '../src/i18n';

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

describe('nativeName', () => {
  it('renders the picker label in the locale itself', () => {
    expect(nativeName('vi')).toBe('Tiếng Việt');
  });

  it('falls back to the uppercased code for an unnamed locale', () => {
    expect(nativeName('xx')).toBe('XX');
  });

  it('names every shipped locale bundle', () => {
    const unnamed = bundledLocales.filter((c) => !NATIVE_NAMES[c]);
    expect(unnamed).toEqual([]);
  });
});

describe('localizedName', () => {
  it('names the language in the viewer locale', () => {
    expect(localizedName('de', 'en')).toBe('German');
    expect(localizedName('en', 'de')).toBe('Englisch');
  });

  it('drops the hint when it echoes the native name', () => {
    expect(localizedName('de', 'de')).toBeNull();
  });

  it('compares the echo case-insensitively', () => {
    // French calls itself lowercase "français"; that is
    // still an echo of native "Français", not a hint.
    expect(localizedName('fr', 'fr')).toBeNull();
  });

  it('returns null for a code the platform cannot name', () => {
    expect(localizedName('xx', 'en')).toBeNull();
  });

  it('returns null for an invalid viewer locale', () => {
    expect(localizedName('de', 'not a tag!')).toBeNull();
  });
});

// A keyed localStorage: the pick and the host `lang` it was
// made under live under separate keys, so a stub that
// answered every getItem the same way would compare the pick
// against itself. Returns the store so a test can read back
// what pickLocale wrote.
function stubBrowser(
  languages: string[], stored: string | null = null,
  storedHost: string | null = null,
): Record<string, string> {
  const store: Record<string, string> = {};
  if (stored) store['tm.locale'] = stored;
  if (storedHost) store['tm.locale.host'] = storedHost;
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
      removeItem: (k: string) => { delete store[k] },
    },
  });
  vi.stubGlobal('navigator', { languages, language: languages[0] });
  return store;
}

describe('detectLocale', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setHostLocale(null);
  });

  it('returns en when no locales are available', () => {
    expect(detectLocale(undefined)).toBe('en');
    expect(detectLocale([])).toBe('en');
  });

  it('prefers the stored prior pick', () => {
    stubBrowser(['fr-FR'], 'de');
    expect(detectLocale(['en', 'de', 'fr'])).toBe('de');
  });

  it('keeps the stored pick on a page that sets no lang', () => {
    // The passport renderer sets no `lang`, so this is where
    // "remember my language" has to keep working.
    stubBrowser(['fr-FR'], 'hi');
    setHostLocale(null);
    expect(detectLocale(['en', 'hi', 'fr'])).toBe('hi');
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

  it('lets the host lang win over a pick made elsewhere', () => {
    // An embedder that pins `lang` is telling the widget to
    // match its page chrome, and its own language picker
    // reloads the page with a new `lang`. A pick the visitor
    // once made in another widget must not shadow that.
    stubBrowser(['fr-FR'], 'hi');
    setHostLocale('en');
    expect(detectLocale(['en', 'hi', 'fr'])).toBe('en');
  });

  it('keeps a pick made on a page carrying this same lang', () => {
    // The in-page picker (the passport footer's, on a page
    // that pins `lang`) promises to remember the choice, so
    // the visitor's own override outranks the page chrome.
    stubBrowser(['fr-FR'], 'hi', 'en');
    setHostLocale('en');
    expect(detectLocale(['en', 'hi', 'fr'])).toBe('hi');
  });

  it('drops a pick made under a different lang', () => {
    // The embedder switched its page to English; a choice
    // made while it served German says nothing about now.
    stubBrowser(['fr-FR'], 'hi', 'de');
    setHostLocale('en');
    expect(detectLocale(['en', 'hi', 'fr'])).toBe('en');
  });

  it('ignores a host lang the data does not offer', () => {
    stubBrowser(['en-US']);
    setHostLocale('xx');
    expect(detectLocale(['en', 'de'])).toBe('en');
  });

  it('falls back to the stored pick when the host lang misses', () => {
    stubBrowser(['fr-FR'], 'de');
    setHostLocale('xx');
    expect(detectLocale(['en', 'de', 'fr'])).toBe('de');
  });

  it('strips the region from the host lang', () => {
    stubBrowser(['fr-FR']);
    setHostLocale('de-AT');
    expect(detectLocale(['en', 'de'])).toBe('de');
  });
});

describe('pickLocale', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setHostLocale(null);
  });

  it('stamps the pick with the lang it was made under', () => {
    const store = stubBrowser(['en-US']);
    setHostLocale('de');
    pickLocale('fr');
    expect(store['tm.locale']).toBe('fr');
    expect(store['tm.locale.host']).toBe('de');
  });

  it('leaves no stamp on a page that sets no lang', () => {
    // And clears a stamp an earlier pick left, so the choice
    // does not stay bound to a page the visitor has left.
    const store = stubBrowser(['en-US'], 'hi', 'de');
    setHostLocale(null);
    pickLocale('fr');
    expect(store['tm.locale']).toBe('fr');
    expect(store['tm.locale.host']).toBeUndefined();
  });
});
