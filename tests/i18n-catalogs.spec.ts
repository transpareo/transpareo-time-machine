/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Guard rails over the locale catalogs themselves, so a
 * translation PR can't silently degrade the UI:
 *
 *   - Key parity: every catalog carries exactly the en.json
 *     key set (t() falls back to English per key, so a
 *     missing key would ship mixed-language UI unnoticed).
 *   - Placeholder parity: the {name} variables per key match
 *     English, so t()'s substitution never leaves a literal
 *     `{count}` on screen.
 *   - Event coverage: every event type the feed can carry
 *     has a pill and a summary line, so a type the
 *     publisher starts emitting cannot reach the card as
 *     its own raw key.
 *   - No markup: label values are plain text. Several
 *     components interpolate labels near innerHTML
 *     templates; keeping `<`, `>`, `"` and script-bearing
 *     URLs out of the catalogs makes a malicious or sloppy
 *     locale PR inert by construction.
 */

import { describe, it, expect } from 'vitest';
import { regionName } from '../src/i18n/display-names';
import {
  EVENT_TYPES, LIFECYCLE_STATUSES, VOID_REASONS
} from '../src/types';
import { colorForEventType } from '../src/event-colors';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = fileURLToPath(
  new URL('../src/i18n/data', import.meta.url),
);

type Catalog = Record<string, string>;

const files = readdirSync(DATA_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

function load(file: string): Catalog {
  return JSON.parse(
    readFileSync(join(DATA_DIR, file), 'utf8'),
  ) as Catalog;
}

const english = load('en.json');
const englishKeys = Object.keys(english).sort();

function placeholdersOf(value: string): string[] {
  return (value.match(/\{(\w+)\}/g) ?? []).sort();
}

describe('locale catalogs', () => {
  it('cover all 40 locales', () => {
    expect(files.length).toBe(40);
    expect(files).toContain('en.json');
    expect(files).toContain('de.json');
    expect(files).toContain('sr.json');
    expect(files).toContain('vi.json');
  });

  it.each(files)('%s matches the en.json key set', (file) => {
    expect(Object.keys(load(file)).sort()).toEqual(englishKeys);
  });

  it.each(files)('%s keeps en.json placeholders per key', (file) => {
    const catalog = load(file);
    for (const key of englishKeys) {
      expect(
        placeholdersOf(catalog[key]),
        `${file} ${key}`,
      ).toEqual(placeholdersOf(english[key]));
    }
  });

  // The timeline reads both keys off the event type it
  // parses, and t() falls back to the key itself, so a
  // type nobody translated renders "eventSummary.voided"
  // in the card body. The publisher decides which types
  // it emits, not this package, so the catalog has to
  // carry all of them before one shows up in the wild.
  it.each(files)('%s labels every event type', (file) => {
    const catalog = load(file);
    const missing = EVENT_TYPES.flatMap((type) => [
      `eventType.${type}`,
      `eventSummary.${type}`,
    ]).filter((key) => !catalog[key]);
    expect(missing, `${file} unlabelled event keys`).toEqual([]);
  });

  // Same for the reason a passport was voided: the band
  // reads one sentence per reason, and canonicalVoidReason
  // folds an unknown token onto `other`, so the four
  // listed here are every sentence that can be asked for.
  it.each(files)('%s words every void reason', (file) => {
    const catalog = load(file);
    const missing = VOID_REASONS
      .map((reason) => `withdrawal.voided.${reason}`)
      .filter((key) => !catalog[key]);
    expect(missing, `${file} unworded void reasons`).toEqual([]);
  });

  // And for the lifecycle stage an event moves a passport
  // into: the card and the event modal name the stage
  // through its `status.*` label, so a stage nobody
  // translated reads as "status.manufactured" on screen.
  it.each(files)('%s names every lifecycle stage', (file) => {
    const catalog = load(file);
    const missing = LIFECYCLE_STATUSES
      .map((status) => `status.${status}`)
      .filter((key) => !catalog[key]);
    expect(missing, `${file} unnamed lifecycle stages`).toEqual([]);
  });

  // A type with no entry in the colour map draws in the
  // muted grey the renderer keeps for the unknown, which
  // reads as a styling choice rather than as the gap it is.
  it('gives every event type its own colour', () => {
    const unmapped = EVENT_TYPES
      .filter((t) => colorForEventType(t) === 'var(--color-muted)');
    expect(unmapped, 'event types with no colour').toEqual([]);
  });

  it.each(files)('%s values carry no markup', (file) => {
    const catalog = load(file);
    for (const [key, value] of Object.entries(catalog)) {
      expect(value, `${file} ${key}`).not.toMatch(/[<>"]/);
      expect(value, `${file} ${key}`).not.toMatch(/javascript:/i);
    }
  });

  // Country values are rendered from their code by Intl, and
  // a locale the platform holds no region data for falls
  // back to the code itself. That fallback is quiet: adding
  // a catalog for a language CLDR does not cover would ship
  // "PT" to those readers with nothing to report it, which
  // is how the wrong-language name went unnoticed on the
  // publishing side. This turns that into a red suite.
  //
  // It proves the data on the runtime the suite runs on, not
  // in every browser. Engines ship full CLDR, so a locale
  // failing here is a locale to think twice about rather
  // than one browsers would quietly handle.
  it('names a country in every locale a catalog exists for', () => {
    // Every country code the fixtures actually carry, not
    // one representative: CLDR is per-locale data, so
    // "this locale has region names" and "this locale has
    // THIS region's name" are different claims.
    const codes = ['PT', 'IT', 'KR', 'CN', 'PL', 'IN', 'TR'];
    const missing = files
      .flatMap((f) => {
        const locale = f.replace('.json', '');
        return codes
          .filter((code) => !regionName(code, locale))
          .map((code) => `${locale}/${code}`);
      });
    expect(missing, 'locale/code pairs with no Intl data').toEqual([]);
  });
});
