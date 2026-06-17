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
} from '@/types'
import { canonicalRating, isLanguageArray, foldLocale } from '@/types'

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

function scalarOrLongText(
  v: SnapshotLocalizedText, unit: string | undefined,
): PropertyValueKind {
  if (isLongText(v)) return { type: 'longText', body: v }
  return { type: 'scalar', value: v, ...(unit ? { unit } : {}) }
}

function toCompositionEntry(raw: unknown): CompositionEntry {
  const sub = raw as Record<string, unknown>
  const rawValue = sub.value
  const percent = typeof rawValue === 'number'
    ? rawValue
    : Number(rawValue) || 0
  const rating = canonicalRating(sub.rating)
  return {
    name: foldLocale(sub.name),
    percent,
    ...(typeof sub.countryCode === 'string'
      ? { countryCode: sub.countryCode } : {}),
    ...(typeof sub.libraryRef === 'string'
      ? { libraryRef: sub.libraryRef } : {}),
    ...(rating ? { rating } : {}),
  }
}

// Classify one wire property value into the renderer's
// kind union. `unit` is the already-resolved display unit
// (from `unitText`, or a mapped `unitCode`), applied to
// scalar tiles only.
export function classifyWireValue(
  raw: unknown, unit: string | undefined,
): PropertyValueKind {
  if (typeof raw === 'number') {
    return {
      type: 'scalar', value: String(raw), numeric: raw,
      ...(unit ? { unit } : {}),
    }
  }
  if (typeof raw === 'string') {
    return scalarOrLongText(raw, unit)
  }
  if (Array.isArray(raw)) {
    if (isLanguageArray(raw)) {
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
