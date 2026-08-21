/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Property-value classification. The signed snapshot
 * carries each property's raw value with no render-hint
 * discriminator ("presentation is not data"); the
 * renderer derives the presentation surface from the
 * shape of the value:
 *
 *   number / short text     -> scalar      (metric tile)
 *   long text               -> longText    (accordion)
 *   language-tagged array   -> scalar / longText (folded to a hash)
 *   array of texts          -> list        (badge group)
 *   array of substances     -> composition (donut)
 *
 * A value's datatype is data, not a render hint, so the
 * one discriminator the classifier does read is the
 * JSON-LD `@type` on a typed literal: it says what the
 * lexical form means (a decimal, an ISO 3166-1 country
 * code), never which surface to paint it on.
 *
 * A localized scalar arrives in the JSON-LD expanded form
 * `[{ '@value', '@language' }, ...]`; it is folded back to a
 * `{ locale: text }` hash at the boundary here so every
 * downstream consumer sees one localized-text shape.
 *
 * Scalar vs longText is a length decision, not a shape
 * one: a value is an accordion when its longest locale
 * rendering exceeds LONG_TEXT_GATE characters or contains
 * a line break, otherwise a tile. The gate is measured
 * across every locale so the surface stays stable when
 * the viewer switches language.
 *
 * A second pass (bridgeLongTextGroups) keeps a run of
 * accordions visually coherent: a lone scalar sandwiched
 * between two accordions is promoted to an accordion too.
 * Promotion is one-way - a real paragraph never collapses
 * into a tile.
 */

import type {
  PropertyValueKind, CompositionEntry, SnapshotLocalizedText,
  WireLangValue,
} from '@/types'
import {
  canonicalRating, isLanguageArray, foldLocale, isRegionLiteral,
} from '@/types'

export const LONG_TEXT_GATE = 60

// A locale-hash maps locale codes to plain strings
// (`{ en: '...', de: '...' }`). Distinct from a substance
// row, whose values are not all strings (`value` is a
// number, `name` is itself a hash).
function isLocaleHash(v: unknown): v is Readonly<Record<string, string>> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.values(v as Record<string, unknown>)
    .every((x) => typeof x === 'string')
}

// A substance row inside a composition value. Detected by
// carrying its own `value` (the percentage) or an explicit
// `@type: "Substance"`, which a plain list item never has.
function isSubstanceLike(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const obj = v as Record<string, unknown>
  return 'value' in obj || obj['@type'] === 'Substance'
}

// The signed wire form for a non-string PropertyValue/
// QuantitativeValue scalar (decimal, integer, boolean,
// date, dateTime): an explicit JSON-LD value object rather
// than the bare JS type, so its RDF datatype at
// verification time never depends on the JSON number's own
// ambiguous int/float-ness. Checked ahead of isLocaleHash,
// which a two-key all-string object would otherwise match.
const NUMERIC_XSD_TYPES = new Set(['xsd:decimal', 'xsd:integer'])

function isTypedLiteral(
  v: unknown,
): v is { readonly '@value': string; readonly '@type': string } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const obj = v as Record<string, unknown>
  return typeof obj['@value'] === 'string' && typeof obj['@type'] === 'string'
    && Object.keys(obj).length === 2
}

// A wire scalar's numeric reading, whether it arrives as a
// bare JSON number or a decimal/integer typed literal.
export function numericWireValue(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
  if (isTypedLiteral(raw) && NUMERIC_XSD_TYPES.has(raw['@type'])) {
    const n = Number(raw['@value'])
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

// Longest character count across all locale renderings of
// a localized scalar (or the length of a plain string).
function maxTextLength(v: SnapshotLocalizedText): number {
  if (typeof v === 'string') return v.length
  let max = 0
  for (const s of Object.values(v)) max = Math.max(max, s.length)
  return max
}

function hasLineBreak(v: SnapshotLocalizedText): boolean {
  if (typeof v === 'string') return v.includes('\n')
  return Object.values(v).some((s) => s.includes('\n'))
}

function isLongText(v: SnapshotLocalizedText): boolean {
  return maxTextLength(v) > LONG_TEXT_GATE || hasLineBreak(v)
}

// Split a language-tagged array back into the entries it
// carries. A property with several values tags each of them
// in every locale, and nothing in the data pairs one
// locale's second value with another's: JSON-LD reads
// multiple values as an unordered set. What does line them
// up is the order the served document lists them in, per
// locale, so entry i of German is entry i of English.
//
// A locale carrying fewer values than the longest one
// cannot be placed, since nothing says which entries it
// skipped. It stays out of the pairing rather than landing
// a value on the wrong row, and tx() falls back to a locale
// that is there. One entry per locale means a plain
// localized scalar, which the caller folds as before.
function languageEntries(
  raw: ReadonlyArray<WireLangValue>,
): ReadonlyArray<Readonly<Record<string, string>>> {
  const byLanguage = new Map<string, string[]>()
  for (const e of raw) {
    const list = byLanguage.get(e['@language'])
    if (list) list.push(e['@value'])
    else byLanguage.set(e['@language'], [e['@value']])
  }
  const counts = [...byLanguage.values()].map((l) => l.length)
  const count = Math.max(...counts)
  const complete = [...byLanguage].filter(([, l]) => l.length === count)
  return Array.from({ length: count }, (_, i) =>
    Object.fromEntries(complete.map(([lang, l]) => [lang, l[i]])))
}

function scalarOrLongText(
  v: SnapshotLocalizedText, unit: string | undefined,
): PropertyValueKind {
  if (isLongText(v)) return { type: 'longText', body: v }
  return { type: 'scalar', value: v, ...(unit ? { unit } : {}) }
}

function toCompositionEntry(raw: unknown): CompositionEntry {
  const sub = raw as Record<string, unknown>
  const percent = parsePercent(sub.value)
  const rating = canonicalRating(sub.rating)
  return {
    name: foldLocale(sub.name),
    ...(percent != null ? { percent } : {}),
    ...(typeof sub.countryCode === 'string'
      ? { countryCode: sub.countryCode } : {}),
    ...(typeof sub.libraryRef === 'string'
      ? { libraryRef: sub.libraryRef } : {}),
    ...(rating ? { rating } : {}),
  }
}

// A substance's share, or undefined when the wire carries
// no numeric quantity. Kept distinct from 0 so a qualitative
// breakdown (names + ratings, no percentages) renders as a
// plain list instead of a column of "0%".
function parsePercent(raw: unknown): number | undefined {
  const numeric = numericWireValue(raw)
  if (numeric != null) return numeric
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

// Classify one wire property value into the renderer's
// kind union. `unit` is the already-resolved display unit
// (from `unitText`, or a mapped `unitCode`), applied to
// scalar tiles only.
export function classifyWireValue(
  raw: unknown, unit: string | undefined,
): PropertyValueKind {
  const numeric = numericWireValue(raw)
  if (numeric != null) {
    const value = isTypedLiteral(raw) ? raw['@value'] : String(raw)
    return { type: 'scalar', value, numeric, ...(unit ? { unit } : {}) }
  }

  // A country keeps its literal intact through the model:
  // the code is the signed value, and tx() names the
  // country at render time, so the tile follows a locale
  // switch. Bypasses the length gate - a country name is
  // never an accordion.
  if (isRegionLiteral(raw)) {
    return { type: 'scalar', value: raw, ...(unit ? { unit } : {}) }
  }
  if (isTypedLiteral(raw)) {
    return scalarOrLongText(raw['@value'], unit)
  }
  if (typeof raw === 'string') {
    return scalarOrLongText(raw, unit)
  }
  if (Array.isArray(raw)) {
    if (isLanguageArray(raw)) {
      const entries = languageEntries(raw)
      if (entries.length > 1) return { type: 'list', items: entries }
      return scalarOrLongText(foldLocale(raw), unit)
    }
    if (raw.length > 0 && isSubstanceLike(raw[0])) {
      return {
        type: 'composition',
        entries: raw.map(toCompositionEntry),
        ...(unit ? { unit } : {}),
      }
    }
    return { type: 'list', items: raw as ReadonlyArray<SnapshotLocalizedText> }
  }
  if (isLocaleHash(raw)) {
    return scalarOrLongText(raw, unit)
  }

  // Unexpected shape degrades to a blank tile rather than
  // throwing, so one malformed row never blanks the page.
  return { type: 'scalar', value: '' }
}

// Promote a lone scalar that sits directly between two
// accordions so a block of long-form rows reads as one
// group. Gap-of-one only: two adjacent scalars between
// accordions stay tiles. One-way - a longText is never
// demoted. Returns the same reference when nothing moved.
export function bridgeLongTextGroups(
  kinds: ReadonlyArray<PropertyValueKind>,
): ReadonlyArray<PropertyValueKind> {
  if (kinds.length < 3) return kinds
  let changed = false
  const out = kinds.map((k, i) => {
    if (k.type !== 'scalar') return k
    const prev = kinds[i - 1]
    const next = kinds[i + 1]
    if (prev?.type === 'longText' && next?.type === 'longText') {
      changed = true
      const promoted: PropertyValueKind = { type: 'longText', body: k.value }
      return promoted
    }
    return k
  })
  return changed ? out : kinds
}
