/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Vendor-prefix gate. Reads the lib + embed build outputs
 * and fails (exit 1) when a rule ships a prefixed
 * declaration without its standard form. lightningcss keeps
 * only the last of a prefixed/standard pair, so a source
 * rule that writes the standard form first loses it in the
 * bundle, and a browser that dropped the prefix (Chromium
 * for -webkit-backdrop-filter) then applies nothing.
 *
 * The checked properties are the standard names the
 * stylesheets under src/styles also write with a prefix,
 * plus ALWAYS_CHECKED. CI invokes this after both
 * `npm run build` and `npm run build:embed`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const OUTPUT_DIRS = ['dist', 'dist-embed']
const VENDOR = /^-(?:webkit|moz|ms|o)-/

// Checked even when the source writes no prefixed form, so
// a rule that keeps only `-webkit-backdrop-filter` still
// fails: Chromium reads the standard name alone.
const ALWAYS_CHECKED = ['backdrop-filter']

export function pairedProperties(sources: string[]): Set<string> {
  const standard = new Set<string>()
  const prefixed = new Set<string>()
  const decl = /^\s*(-?[a-z][a-z-]*)\s*:/gm
  for (const text of sources) {
    for (const [, name] of text.matchAll(decl)) {
      if (VENDOR.test(name)) prefixed.add(name.replace(VENDOR, ''))
      else standard.add(name)
    }
  }
  const paired = [...prefixed].filter((name) => standard.has(name))
  return new Set([...ALWAYS_CHECKED, ...paired])
}

// Selectors of the leaf rules (innermost `{...}` blocks) that
// declare a prefixed form of a checked property without the
// standard one.
export function unpairedRules(css: string, props: Set<string>): string[] {
  const failures: string[] = []
  for (const [, selector, body] of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
    const names = body
      .split(';')
      .map((d) => d.split(':')[0].trim())
    const lost = names.some((name) => {
      const bare = name.replace(VENDOR, '')
      return bare !== name && props.has(bare) && !names.includes(bare)
    })
    if (lost) failures.push(selector.trim())
  }
  return failures
}

async function filesUnder(dir: string, ext: RegExp): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true })
  return entries.filter((e) => ext.test(e)).map((e) => join(dir, e))
}

async function main(): Promise<void> {
  const styles = await filesUnder(join(ROOT, 'src/styles'), /\.s?css$/)
  const sources = await Promise.all(styles.map((f) => readFile(f, 'utf8')))
  const props = pairedProperties(sources)
  console.log(`[prefixes] checking ${[...props].sort().join(', ')}`)

  let failed = false
  for (const dir of OUTPUT_DIRS) {
    let outputs: string[]
    try {
      outputs = await filesUnder(join(ROOT, dir), /\.(js|css)$/)
    } catch (err) {
      console.error(`[prefixes] ${dir}/: missing (${err})`)
      failed = true
      continue
    }
    for (const file of outputs) {
      const rules = unpairedRules(await readFile(file, 'utf8'), props)
      for (const rule of rules) {
        console.error(`[prefixes] FAIL ${file.slice(ROOT.length + 1)}:`
          + ` ${rule.slice(-80)} lost its standard form`)
      }
      if (rules.length > 0) failed = true
    }
  }
  if (failed) process.exit(1)
  console.log('[prefixes] ok')
}

if (resolve(process.argv[1] ?? '') === import.meta.filename) void main()
