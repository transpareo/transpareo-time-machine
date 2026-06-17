/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * JSON Canonicalization Scheme (RFC 8785). Produces a
 * byte-stable serialization of a JSON value: object
 * keys sorted lexicographically by UTF-16 code unit,
 * numbers in ECMA 262 ToString form, strings escaped
 * per RFC 8259's minimal rule, no whitespace.
 *
 * Used on both ends of the proof flow: the seed
 * pipeline canonicalizes a snapshot to compute its
 * signing input; the SPA's verifier canonicalizes the
 * same snapshot (with proofValue removed) to recompute
 * what the signer signed. Identical bytes on both sides
 * is the invariant the whole signature scheme rests on.
 *
 * Inputs that cannot be canonicalized (non-finite
 * numbers, bigints, symbols, functions, undefined in
 * an array position) throw. Undefined values inside
 * objects are skipped, matching JSON.stringify's
 * behaviour and the JSON data model.
 */

export function canonicalize(value: unknown): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('JCS: non-finite number')
      }
      return JSON.stringify(value)
    case 'string':
      return JSON.stringify(value)
    case 'object':
      return Array.isArray(value)
        ? canonicalizeArray(value)
        : canonicalizeObject(value as Record<string, unknown>)
    default:
      throw new Error(`JCS: unsupported value type: ${typeof value}`)
  }
}

function canonicalizeArray(arr: ReadonlyArray<unknown>): string {
  const items: string[] = []
  for (const item of arr) {
    if (item === undefined) {
      throw new Error('JCS: undefined in array position')
    }
    items.push(canonicalize(item))
  }
  return `[${items.join(',')}]`
}

function canonicalizeObject(obj: Record<string, unknown>): string {
  // Sort by UTF-16 code unit value, which is what JS's
  // default Array.sort does for strings via Abstract
  // Relational Comparison. Matches RFC 8785 step 3.2.3.
  const keys = Object.keys(obj).sort()
  const parts: string[] = []
  for (const key of keys) {
    const v = obj[key]
    if (v === undefined) continue
    parts.push(`${JSON.stringify(key)}:${canonicalize(v)}`)
  }
  return `{${parts.join(',')}}`
}
