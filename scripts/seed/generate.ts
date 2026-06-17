/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `npm run seed` entry point. Glob every fixture YAML
 * in `fixtures/`, validate it against the zod schema,
 * download any images it references into
 * `public/fixtures/<id>/`, then emit the matching
 * TypeScript into `src/fixtures/_generated/<id>/`.
 *
 * Idempotent, cached images stay, generated TS is
 * overwritten. Validation failure exits non-zero with
 * a precise location ("at `snapshots[2].images[1]`:
 * unknown image key 'lifestyle-c'").
 *
 * Run via `npm run seed`, which wraps this script in
 * `scripts/seed.sh` and invokes it through `tsx`.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { FixtureSchema, type Fixture } from './schema.ts';
import { copyAsset, downloadImage } from './download-images.ts';
import {
  emitFixture,
  type BrandingAssets,
  type ImageMap,
} from './emit-artefacts.ts';
import { buildSnapshotSigner } from './signing.ts';

type AssetSource = { url: string } | { file: string };

const ROOT = join(import.meta.dirname, '..', '..');
const FIXTURES_DIR = join(ROOT, 'fixtures');
const PUBLIC_DIR = join(ROOT, 'public');

async function main(): Promise<void> {
  const entries = await readdir(FIXTURES_DIR).catch(() => [] as string[]);
  const yamlFiles = entries.filter((f) => /\.ya?ml$/.test(f));

  if (yamlFiles.length === 0) {
    console.log('No fixtures/*.yml found, nothing to seed.');
    return;
  }

  for (const file of yamlFiles) {
    const path = join(FIXTURES_DIR, file);
    console.log(`seeding ${file}`);
    const fixture = await load(path);
    const images = await fetchImages(fixture);
    const branding = await fetchBranding(fixture);
    const signer = await buildSnapshotSigner(
      PUBLIC_DIR,
      fixture.id,
      fixture.code,
      fixture.published_at,
    );
    const out = await emitFixture(
      fixture, images, branding, signer,
    );
    console.log(`  emitted ${relative(out)}`);
  }
}

async function load(path: string): Promise<Fixture> {
  const raw = parseYaml(await readFile(path, 'utf8'));
  try {
    return FixtureSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((i) =>
        `  at \`${i.path.join('.')}\`: ${i.message}`).join('\n');
      console.error(`${path}: schema validation failed:\n${issues}`);
      process.exit(1);
    }
    throw err;
  }
}

async function fetchBranding(
  fixture: Fixture,
): Promise<BrandingAssets | null> {
  const b = fixture.branding;
  if (!b) return null;

  // CSS body: inline string is used verbatim; an object
  // with a `url:` triggers a fetch; an object with a
  // `file:` reads from disk. Result is what the SPA
  // injects as a <style> tag when the backend isn't
  // reachable.
  const cssBody = typeof b.css === 'string'
    ? b.css
    : 'url' in b.css
      ? await fetchText(b.css.url)
      : await readFile(join(ROOT, b.css.file), 'utf8');

  const icons: Array<{ size: number; url: string }> = [];

  let logoUrl: string | undefined;
  if (b.logo) {
    const r = await seedAsset(fixture.id, 'logo', b.logo, 'svg');
    logoUrl = r.path;
  }

  let faviconUrl: string | undefined;
  if (b.favicon) {
    const r = await seedAsset(fixture.id, 'favicon', b.favicon, 'ico');
    faviconUrl = r.path;
  }

  for (const icon of b.icons ?? []) {
    const r = await seedAsset(
      fixture.id, `icon-${icon.size}`, icon, 'png',
    );
    icons.push({ size: icon.size, url: r.path });
  }

  return {
    cssBody,
    ...(logoUrl ? { logoUrl } : {}),
    ...(b.logo?.width ? { logoWidth: b.logo.width } : {}),
    ...(faviconUrl ? { faviconUrl } : {}),
    icons,
  };
}

async function seedAsset(
  fixtureId: string,
  key: string,
  source: AssetSource,
  defaultExt: string,
): Promise<{ path: string }> {
  const r = 'file' in source
    ? await copyAsset({
        fixtureId, key, source: source.file, subdir: 'branding',
      })
    : await downloadImage({
        fixtureId, key, url: source.url, subdir: 'branding', defaultExt,
      });
  console.log(`  ${r.cached ? 'cached ' : 'seeded '} ${r.path}`);
  return { path: r.path };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch branding CSS ${url}: ${res.status} ${res.statusText}`,
    );
  }
  return res.text();
}

async function fetchImages(fixture: Fixture): Promise<ImageMap> {
  const out: Record<string, { thumbnail: string; large: string }> = {};
  for (const [key, img] of Object.entries(fixture.images)) {
    const thumb = await downloadImage({
      fixtureId: fixture.id,
      key: `${key}-thumbnail`,
      url: img.thumbnail,
    });
    console.log(`  ${thumb.cached ? 'cached ' : 'fetched'} ${thumb.path}`);
    const large = await downloadImage({
      fixtureId: fixture.id,
      key: `${key}-large`,
      url: img.large,
    });
    console.log(`  ${large.cached ? 'cached ' : 'fetched'} ${large.path}`);
    out[key] = { thumbnail: thumb.path, large: large.path };
  }
  return out;
}

function relative(absPath: string): string {
  return absPath.startsWith(ROOT)
    ? absPath.slice(ROOT.length + 1)
    : absPath;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
