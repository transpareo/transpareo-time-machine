/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Which runner owns which spec. A spec that imports
 * @playwright/test has to be named in two places: the
 * playwright config's testMatch, so the browser suite runs
 * it, and the vitest config's exclude, so vitest never
 * imports it. Miss the second and the Playwright runner
 * throws on the first test() call, which fails the whole
 * `npm test` step rather than skipping one file.
 *
 * Both configs are read here as the objects the runners
 * actually use, so wiring a new browser spec into only one
 * of them fails locally instead of in CI.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vitestConfig from '../vitest.config';
import playwrightConfig from '../playwright.config';

const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url));

// Importing the Playwright runner is what makes a spec a
// browser spec; nothing else separates the two kinds. The
// match is on the import statement, not on the module name
// anywhere in the file, and this file names itself out: it
// talks about the module without ever importing it.
const SELF = 'runner-split.spec.ts';
const IMPORTS_RUNNER = /from\s+['"]@playwright\/test['"]/;

const browserSpecs = readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.spec.ts') && f !== SELF)
  .filter((f) => {
    const src = readFileSync(join(TESTS_DIR, f), 'utf8');
    return IMPORTS_RUNNER.test(src);
  })
  .map((f) => `tests/${f}`)
  .sort();

const excluded = (vitestConfig.test?.exclude ?? [])
  .filter((p) => p.startsWith('tests/'))
  .sort();

const rawMatch = playwrightConfig.testMatch ?? [];
const testMatch = (
  Array.isArray(rawMatch) ? rawMatch : [rawMatch]
) as ReadonlyArray<RegExp>;

describe('runner split', () => {
  it('has browser specs to check', () => {
    expect(browserSpecs.length).toBeGreaterThan(0);
  });

  it.each(browserSpecs)('%s is excluded from vitest', (spec) => {
    expect(excluded).toContain(spec);
  });

  it.each(browserSpecs)('%s is matched by playwright', (spec) => {
    expect(testMatch.some((re) => re.test(spec))).toBe(true);
  });

  // The exclude list is hand-written, so a renamed or
  // deleted browser spec can leave a dead entry behind that
  // silently excludes nothing.
  it('excludes exactly the browser specs, no stale names', () => {
    expect(excluded).toEqual(browserSpecs);
  });
});
