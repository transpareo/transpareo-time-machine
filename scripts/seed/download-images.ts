/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Fetch fixture images into `public/fixtures/<id>/` so
 * the SPA's gallery resolves them via the same path
 * the codegen emits. Files are skipped when already
 * present, `npm run seed` is idempotent.
 *
 * Replaces the curl loop in the previous bash seed.sh.
 * Run via `tsx scripts/seed/generate.ts`.
 */

import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { createHash } from 'node:crypto';

export interface DownloadJob {
  readonly fixtureId: string;
  readonly key: string;     // e.g. 'lifestyle-a' or 'logo'
  readonly url: string;
  /** Optional digest the caller wants verified. */
  readonly expectedSha256?: string;
  /** Sub-directory inside the fixture's bucket. */
  readonly subdir?: string;
  /** Fallback extension when the URL doesn't carry one. */
  readonly defaultExt?: string;
}

export interface DownloadResult {
  readonly path: string;     // public-relative, e.g. '/fixtures/<id>/<key>.jpg'
  readonly sha256: string;   // actual digest, useful for embedding
  readonly cached: boolean;
}

const ROOT = join(import.meta.dirname, '..', '..');
const PUBLIC_FIXTURES = join(ROOT, 'public', 'fixtures');

export async function downloadImage(
  job: DownloadJob,
): Promise<DownloadResult> {
  const ext = extensionFor(job.url, job.defaultExt ?? 'jpg');
  const subdir = job.subdir ? `${job.subdir}/` : '';
  const dir = join(PUBLIC_FIXTURES, job.fixtureId, job.subdir ?? '');
  const out = join(dir, `${job.key}.${ext}`);
  const rel = `/fixtures/${job.fixtureId}/${subdir}${job.key}.${ext}`;

  if (await exists(out)) {
    return { path: rel, sha256: await sha256File(out), cached: true };
  }
  await mkdir(dirname(out), { recursive: true });

  const res = await fetch(job.url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${job.url}: ${res.status} ${res.statusText}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = createHash('sha256').update(buf).digest('hex');
  if (job.expectedSha256 && job.expectedSha256 !== sha) {
    throw new Error(
      `sha256 mismatch for ${job.url}\n`
      + `  expected: ${job.expectedSha256}\n`
      + `  got:      ${sha}`,
    );
  }
  await writeFile(out, buf);
  return { path: rel, sha256: sha, cached: false };
}

export interface CopyJob {
  readonly fixtureId: string;
  readonly key: string;
  readonly source: string;        // repo-relative path
  readonly subdir?: string;
}

const REPO_ROOT = ROOT;

export async function copyAsset(
  job: CopyJob,
): Promise<DownloadResult> {
  const ext = (extname(job.source) || '.bin').slice(1).toLowerCase();
  const subdir = job.subdir ? `${job.subdir}/` : '';
  const dir = join(PUBLIC_FIXTURES, job.fixtureId, job.subdir ?? '');
  const out = join(dir, `${job.key}.${ext}`);
  const rel = `/fixtures/${job.fixtureId}/${subdir}${job.key}.${ext}`;
  const src = job.source.startsWith('/')
    ? job.source
    : join(REPO_ROOT, job.source);

  const srcSha = await sha256File(src);
  if (await exists(out) && (await sha256File(out)) === srcSha) {
    return { path: rel, sha256: srcSha, cached: true };
  }
  await mkdir(dirname(out), { recursive: true });
  await copyFile(src, out);
  return { path: rel, sha256: srcSha, cached: false };
}

// Image extensions we will write to disk. An extension
// parsed from a remote URL that isn't on this list falls
// back to the caller's default instead of becoming part of
// the on-disk filename verbatim.
const SAFE_IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'svg', 'gif', 'avif', 'ico',
]);

function extensionFor(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname;
    const dot = pathname.lastIndexOf('.');
    if (dot >= 0 && dot >= pathname.length - 5) {
      const ext = pathname.slice(dot + 1).toLowerCase();
      if (SAFE_IMAGE_EXTENSIONS.has(ext)) return ext;
    }
  } catch { /* malformed url, fall through */ }
  return fallback;
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch { return false; }
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
