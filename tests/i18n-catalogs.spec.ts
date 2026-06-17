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
 *   - No markup: label values are plain text. Several
 *     components interpolate labels near innerHTML
 *     templates; keeping `<`, `>`, `"` and script-bearing
 *     URLs out of the catalogs makes a malicious or sloppy
 *     locale PR inert by construction.
 */

import { describe, it, expect } from 'vitest';
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
  it('cover all 39 locales', () => {
    expect(files.length).toBe(39);
    expect(files).toContain('en.json');
    expect(files).toContain('de.json');
    expect(files).toContain('sr.json');
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

  it.each(files)('%s values carry no markup', (file) => {
    const catalog = load(file);
    for (const [key, value] of Object.entries(catalog)) {
      expect(value, `${file} ${key}`).not.toMatch(/[<>"]/);
      expect(value, `${file} ${key}`).not.toMatch(/javascript:/i);
    }
  });
});
