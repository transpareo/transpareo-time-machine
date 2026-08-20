// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Enum rows in a component-library artefact carry a code
 * plus a label map baked at publish time. That map is a
 * snapshot of whatever translations the publisher had on
 * the day, so a locale can be missing from it, and the
 * artefact is immutable at a versioned path: the gap
 * survives until someone republishes.
 *
 * These cases pin what the renderer does about it. A coded
 * country resolves through Intl in the viewer's language,
 * so a reader is never handed a name in a language they did
 * not ask for; anything else keeps the publisher's own
 * wording and the existing fallback chain.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { enumLabel } from '@/components/dpp-library-modal'
import { locale } from '@/i18n'
import type { ComponentPropertyValue } from '@/types'

type EnumValue = Extract<ComponentPropertyValue, { type: 'enum' }>

// Spelled out rather than imported: this is the wire
// contract a library artefact has to match, and a test that
// reads it from the same constant the code reads would
// agree with any value at all.
const DT = 'https://transpareo.com/vocab/transpareo/v1#iso3166-1-alpha2'

const country = (label: Record<string, string>): EnumValue =>
  ({ type: 'enum', value: 'PT', label })

beforeEach(() => {
  locale.set('en')
})

describe('enumLabel: the publisher wrote this locale', () => {
  it('uses the baked label, deliberate wording and all', () => {
    locale.set('de')
    const v = country({ en: 'Portugal', de: 'Portugal (EU)' })
    expect(enumLabel(v)).toBe('Portugal (EU)')
  })

  it('uses a plain string label as-is', () => {
    const v: EnumValue = { type: 'enum', value: 'PT', label: 'Portugal' }
    expect(enumLabel(v)).toBe('Portugal')
  })
})

describe('enumLabel: the publisher missed this locale', () => {
  // The map here is what a publisher ships when its
  // translation source keys some languages regionally and
  // the lookup used the bare tag: 39 locales present, one
  // silently absent.
  it('names a country in the viewer language instead of English', () => {
    locale.set('zh')
    expect(enumLabel(country({ en: 'Portugal', de: 'Portugal' })))
      .toBe('葡萄牙')
  })

  it('still resolves for a locale the map does carry in English only', () => {
    locale.set('ro')
    expect(enumLabel(country({ en: 'Portugal' }))).toBe('Portugalia')
  })

  // No English entry means nothing vouches for the code
  // being a country, so the code stands rather than a
  // guessed country name or a blank cell.
  it('shows the code when the map vouches for nothing', () => {
    locale.set('ja')
    expect(enumLabel(country({}))).toBe('PT')
  })

  // Deliberate wording fails the check by design; the
  // publisher's English is a better answer than overriding
  // a label they chose.
  it('keeps a reworded English label rather than overriding it', () => {
    locale.set('ja')
    expect(enumLabel(country({ en: 'Portugal (EU)' }))).toBe('Portugal (EU)')
  })
})

// A row that declares the country datatype is taken at its
// word, so none of the guessing below applies to it. The
// field is what the artefact says the code is, and it is
// the same IRI the snapshot types a country literal with.
describe('enumLabel: the row declares its datatype', () => {
  const typed = (value: string, label: Record<string, string>): EnumValue =>
    ({ type: 'enum', value, label, dataType: DT })

  it('names the country without asking the label to vouch', () => {
    locale.set('ja')
    expect(enumLabel(typed('PT', {}))).toBe('ポルトガル')
  })

  it('resolves even where the English label is a synonym', () => {
    locale.set('de')
    expect(enumLabel(typed('PT', { en: 'Portuguese Republic' })))
      .toBe('Portugal')
  })

  // The anchor check exists because "NO" is usually not
  // Norway. Declared, it is: the artefact is a better
  // authority than the shape of the value, which is the
  // whole reason the field was added.
  it('trusts the declaration even for a code that usually is not one', () => {
    locale.set('de')
    expect(enumLabel(typed('NO', {}))).toBe('Norwegen')
  })

  // The declaration outranks the baked label even for the
  // viewer's own locale. The datatype's definition puts the
  // naming on the reader, and a publisher wanting
  // particular wording wants a text row instead.
  it('resolves ahead of the publisher label for the active locale', () => {
    locale.set('de')
    expect(enumLabel(typed('PT', { de: 'Portugal (EU)' }))).toBe('Portugal')
  })

  // The reason that ordering matters, rather than being a
  // preference: a name baked at publish time goes stale.
  // Turkey, Czechia and Eswatini all renamed inside a
  // decade while their codes held.
  it('renames a country whose label was frozen under the old name', () => {
    locale.set('en')
    expect(enumLabel(typed('TR', { en: 'Turkey' }))).toBe('Türkiye')
    expect(enumLabel(typed('CZ', { en: 'Czech Republic' }))).toBe('Czechia')
    expect(enumLabel(typed('SZ', { en: 'Swaziland' }))).toBe('Eswatini')
  })

  // Unresolvable, so the label is still the better answer.
  it('falls back to the label when a declared code names nothing', () => {
    locale.set('de')
    expect(enumLabel(typed('QQ', { de: 'Irgendwo' }))).toBe('Irgendwo')
  })

  it('falls back to the code when a declared value resolves to nothing', () => {
    locale.set('de')
    expect(enumLabel(typed('QQ', {}))).toBe('QQ')
  })
})

// Two letters are not evidence of a country. These values
// are all assigned ISO 3166-1 codes AND plausible enum
// members, so resolving them by shape alone would render
// Norway, Indonesia, Iceland and Montenegro into rows that
// mean no, an identifier kind, a class and a size.
describe('enumLabel: values that only look like country codes', () => {
  const collisions: ReadonlyArray<readonly [string, string, string]> = [
    ['NO', 'No', 'Norwegen'],
    ['ID', 'Identifier', 'Indonesien'],
    ['IS', 'Class IS', 'Island'],
    ['ME', 'Medium', 'Montenegro'],
  ]

  it.each(collisions)(
    '%s keeps the publisher label and never becomes %s',
    (code, english, country_) => {
      locale.set('de')
      const v: EnumValue = { type: 'enum', value: code, label: { en: english } }
      expect(enumLabel(v)).toBe(english)
      expect(enumLabel(v)).not.toBe(country_)
    },
  )

  it('keeps the existing fallback for a code Intl cannot name', () => {
    locale.set('de')
    const v: EnumValue = {
      type: 'enum', value: 'XL', label: { en: 'Extra large' },
    }
    expect(enumLabel(v)).toBe('Extra large')
  })

  it('falls back to the raw code when no label is usable', () => {
    locale.set('de')
    const v: EnumValue = { type: 'enum', value: 'A2', label: {} }
    expect(enumLabel(v)).toBe('A2')
  })
})
