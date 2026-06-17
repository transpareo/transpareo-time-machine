/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Network-free fixture validator. Parses every
 * `fixtures/*.yml` through the Zod schema and exits
 * non-zero on the first failure with a precise path
 * (`at \`snapshots[2].images[1]\`: ...`).
 *
 * This is the CI counterpart to `npm run seed`. Seeding
 * downloads upstream images at runtime, so it cannot
 * run in a deterministic CI lane. This script catches
 * schema regressions without touching the network.
 *
 * Run via `npm run check:fixtures`.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { FixtureSchema } from './schema.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const FIXTURES_DIR = join(ROOT, 'fixtures');

async function main(): Promise<void> {
  const entries = await readdir(FIXTURES_DIR).catch(() => [] as string[]);
  const yamlFiles = entries.filter((f) => /\.ya?ml$/.test(f)).sort();

  if (yamlFiles.length === 0) {
    console.log('No fixtures/*.yml found, nothing to validate.');
    return;
  }

  let failed = 0;
  for (const file of yamlFiles) {
    const path = join(FIXTURES_DIR, file);
    const raw = parseYaml(await readFile(path, 'utf8'));
    const result = FixtureSchema.safeParse(raw);
    if (result.success) {
      console.log(`ok    ${file}`);
      continue;
    }
    failed++;
    console.error(`FAIL  ${file}`);
    for (const issue of (result.error as z.ZodError).issues) {
      const path = issue.path.length ? issue.path.join('.') : '<root>';
      console.error(`  at \`${path}\`: ${issue.message}`);
    }
  }

  if (failed > 0) {
    console.error(
      `\n${failed} of ${yamlFiles.length} fixtures failed validation.`,
    );
    process.exit(1);
  }
  console.log(`\n${yamlFiles.length} fixtures validated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
