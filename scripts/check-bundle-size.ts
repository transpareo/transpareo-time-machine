/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Bundle-size gate. Reads the lib + embed build outputs
 * and asserts each is under its gzipped budget. Fails
 * the process (exit 1) if any output exceeds, or if any
 * expected output is missing (so a forgotten build step
 * trips CI instead of silently passing).
 *
 * Budgets are quoted as gzipped because that's what
 * actually crosses the wire; the raw byte count is
 * mostly a curiosity. CI invokes this after both
 * `npm run build` and `npm run build:embed`.
 */
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'

interface Budget {
  readonly file: string
  readonly maxGzipBytes: number

  // Build output directory the file lives in. The lib
  // build emits to dist/, the embed build to
  // dist-embed/; both feed the same budget gate so a
  // forgotten build step trips a missing-file failure
  // instead of a silently-skipped check.
  readonly dir: 'dist' | 'dist-embed'
}

// The lib + embed floors include the bundled inline
// functional icon sprite, the element-config parser, and
// the two-cryptosuite verifier (eddsa-jcs + the ecdsa-sd
// selective-disclosure path with its cached JSON-LD
// contexts); the embed entry also inlines app.css. The gate
// catches a bundle that grows by a chunk nobody meant to
// ship. Raise it when a deliberate feature earns the bytes,
// and say so.
const BUDGETS: ReadonlyArray<Budget> = [
  // 74 KB since the asset host and pinned keys first: the
  // root-path resolver, the revocation default and the key
  // selection both cryptosuites share. It went to 73 KB for
  // model and lot passports: the walk-up band, the
  // unit-passport line, their labels and four context terms.
  { file: 'transpareo-time-machine.js', maxGzipBytes: 74 * 1024, dir: 'dist' },
  // 33 KB since a DID document can withdraw a key: the
  // `revoked` and `assertionMethod` checks. 32 KB came with
  // the key selection above (the bundled English catalog and
  // the Transpareo context ride every entry whole), 31 KB
  // with the withdrawal sentences.
  { file: 'dpp-verifier.js', maxGzipBytes: 33 * 1024, dir: 'dist' },
  { file: 'embed.js', maxGzipBytes: 72 * 1024, dir: 'dist-embed' },
]

// Vite's lib mode emits entry + chunks; when two entry
// points share modules, the entry file degenerates into
// a re-export stub and the real code lives in a sibling
// chunk under locales/. The budget is what the embedder
// actually downloads, so we resolve the entry + every
// chunk it pulls in transitively and measure the
// concatenated gzipped bytes.
async function bytesForEntry(entryPath: string): Promise<Buffer> {
  const seen = new Set<string>()
  const parts: Buffer[] = []
  await walk(entryPath)
  return Buffer.concat(parts)

  async function walk(p: string): Promise<void> {
    const abs = resolve(p)
    if (seen.has(abs)) return
    seen.add(abs)
    const bytes = await readFile(abs)
    parts.push(bytes)
    const text = bytes.toString('utf8')

    // Matches `from "x"` and the static `import "x"` form,
    // with or without the space a minifier drops (the embed
    // build writes `from"./x.js"`). Dynamic `import("x")` is
    // intentionally NOT followed: those chunks (the
    // per-locale label files) load on demand, and a visitor
    // fetches the entry plus a single locale, not all of
    // them. Counting every locale here would inflate the
    // budget far past what is downloaded.
    const re = /\b(?:from|import)\s*["']([^"']+)["']/g
    let m
    while ((m = re.exec(text)) != null) {
      const spec = m[1]
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue
      await walk(join(dirname(abs), spec))
    }
  }
}

async function main(): Promise<void> {
  let failed = false
  for (const b of BUDGETS) {
    const path = join(process.cwd(), b.dir, b.file)
    let bytes: Buffer
    try {
      bytes = await bytesForEntry(path)
    } catch (err) {
      console.error(`[budget] ${b.file}: missing in ${b.dir}/ (${err})`)
      failed = true
      continue
    }
    const gz = gzipSync(bytes).byteLength
    const pad = (n: number): string => (n / 1024).toFixed(2).padStart(7)
    const status = gz <= b.maxGzipBytes ? 'ok ' : 'FAIL'
    console.log(
      `[budget] ${status} ${b.file.padEnd(32)}`
      + ` gzip ${pad(gz)} KB / ${pad(b.maxGzipBytes)} KB`,
    )
    if (gz > b.maxGzipBytes) failed = true
  }
  if (failed) process.exit(1)
}

void main()
