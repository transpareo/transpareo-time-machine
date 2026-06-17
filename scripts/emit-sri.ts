/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Subresource Integrity manifest emitter. Walks each build
 * output tree (`dist/` for the lib build, `dist-embed/` for
 * the single-file embed build) recursively and writes an
 * `integrity.json` next to it with one entry per publishable
 * asset, keyed by its path relative to the tree root:
 *
 *   {
 *     "transpareo-time-machine.js": { "sha384": "...", ... },
 *     "locales/en.js":             { "sha384": "...", ... },
 *     ...
 *   }
 *
 * The walk is recursive on purpose: the lib bundle pulls its
 * per-locale label chunks and the verifier chunk in via
 * dynamic `import("./locales/*.js")`, so those files execute
 * on the page and must be covered. (A browser `<script
 * integrity>` tag only protects the entry file; pinning the
 * lazily-imported chunks needs an import-map with per-chunk
 * integrity. The manifest lists the hashes either way.)
 *
 * The sha256-hex entry doubles as the reproducible-build
 * fingerprint a downstream double-build can compare against.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, sep } from 'node:path'

interface Hashes {
  readonly sha384: string
  readonly sha512: string
  readonly 'sha256-hex': string
}

// Recursively list publishable .js/.css files under root,
// returning paths relative to root with POSIX separators so
// the keys match the URL path a browser requests
// (e.g. "locales/en.js").
async function listArtefacts(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (!entry.name.endsWith('.js') && !entry.name.endsWith('.css')) continue
      out.push(relative(root, full).split(sep).join('/'))
    }
  }
  await walk(root)
  return out.sort()
}

function hashesOf(bytes: Buffer): Hashes {
  return {
    sha384:
      'sha384-' + createHash('sha384').update(bytes).digest('base64'),
    sha512:
      'sha512-' + createHash('sha512').update(bytes).digest('base64'),
    'sha256-hex': createHash('sha256').update(bytes).digest('hex'),
  }
}

// Write <root>/integrity.json for one build tree. Returns
// false (skipping silently) when the tree wasn't built.
async function emitManifest(root: string, label: string): Promise<void> {
  let files: string[]
  try {
    files = await listArtefacts(root)
  } catch {
    console.log(`[sri] ${label} not present, skipping`)
    return
  }
  const manifest: Record<string, Hashes> = {}
  for (const f of files) {
    manifest[f] = hashesOf(await readFile(join(root, f)))
  }
  const sorted: Record<string, Hashes> = {}
  for (const k of Object.keys(manifest).sort()) sorted[k] = manifest[k]
  const json = JSON.stringify(sorted, null, 2) + '\n'
  await writeFile(join(root, 'integrity.json'), json, 'utf8')
  console.log(
    `[sri] wrote ${label}/integrity.json with ${files.length} entries`,
  )
}

async function main(): Promise<void> {
  const cwd = process.cwd()
  await emitManifest(join(cwd, 'dist'), 'dist')
  await emitManifest(join(cwd, 'dist-embed'), 'dist-embed')
}

void main()
