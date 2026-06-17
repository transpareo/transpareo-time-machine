/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * URL `?show=` parser + namespace-unlock match
 * semantics for the access-gating design. Two units:
 *
 *   parseShowParam(search) - normalises the comma form
 *   and the bracketed form into a deduplicated,
 *   order-preserved token list.
 *
 *   isUnlocked(namespace, tokens) - the per-row gate
 *   the renderer applies to category-2 (on-demand)
 *   rows: bare token = prefix match, token with `:` =
 *   exact match.
 *
 * No DOM, no signal wiring; pure function tests.
 */
import { describe, expect, it } from 'vitest'
import { parseShowParam, isUnlocked } from '../src/show-filter'

describe('parseShowParam', () => {
  it('returns empty for empty / missing search', () => {
    expect(parseShowParam('')).toEqual([])
    expect(parseShowParam('?')).toEqual([])
    expect(parseShowParam('?foo=bar')).toEqual([])
  })

  it('parses a single comma-form value', () => {
    expect(parseShowParam('?show=transpareo')).toEqual(['transpareo'])
  })

  it('parses multiple comma-form tokens', () => {
    expect(parseShowParam('?show=transpareo,battpass:annexXIII'))
      .toEqual(['transpareo', 'battpass:annexXIII'])
  })

  it('parses the bracketed form', () => {
    expect(parseShowParam('?show[]=transpareo&show[]=battpass'))
      .toEqual(['transpareo', 'battpass'])
  })

  it('merges comma + bracketed forms in one URL', () => {
    expect(parseShowParam('?show=a,b&show[]=c&show[]=d,e'))
      .toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('dedupes while preserving first-seen order', () => {
    expect(parseShowParam('?show=a,b,a,c,b')).toEqual(['a', 'b', 'c'])
  })

  it('trims whitespace from each token', () => {
    expect(parseShowParam('?show= a , b ,c')).toEqual(['a', 'b', 'c'])
  })

  it('drops empty tokens caused by trailing/double commas', () => {
    expect(parseShowParam('?show=a,,b,')).toEqual(['a', 'b'])
  })
})

describe('isUnlocked', () => {
  it('matches a bare-token prefix against a colon-suffixed namespace', () => {
    expect(isUnlocked('transpareo:capacityWh', ['transpareo'])).toBe(true)
  })

  it('matches a bare token against the exact namespace', () => {
    expect(isUnlocked('transpareo', ['transpareo'])).toBe(true)
  })

  it('does NOT prefix-match across letters within a token', () => {
    // `trans` is a bare token but `transpareo:foo` is
    // not a prefix of it - the rule is namespace-segment
    // prefix (`token + ':'`), not raw string prefix.
    expect(isUnlocked('transpareo:foo', ['trans'])).toBe(false)
  })

  it('matches a colon-token only by exact equality', () => {
    expect(isUnlocked('transpareo:capacityWh', ['transpareo:capacityWh']))
      .toBe(true)
    expect(isUnlocked('transpareo:capacityKwh', ['transpareo:capacityWh']))
      .toBe(false)

    // A colon-token does NOT prefix-match - a deeper
    // namespace isn't unlocked by a parent colon-token.
    expect(isUnlocked('transpareo:capacityWh:peak', ['transpareo:capacityWh']))
      .toBe(false)
  })

  it('matches across multiple tokens (set-union)', () => {
    const tokens = ['battpass:annexXIII', 'transpareo']
    expect(isUnlocked('transpareo:capacityWh', tokens)).toBe(true)
    expect(isUnlocked('battpass:annexXIII', tokens)).toBe(true)
    expect(isUnlocked('espr:durabilityScore', tokens)).toBe(false)
  })

  it('returns false for missing or empty namespace', () => {
    expect(isUnlocked(undefined, ['transpareo'])).toBe(false)
    expect(isUnlocked('', ['transpareo'])).toBe(false)
  })

  it('returns false for an empty token list', () => {
    expect(isUnlocked('transpareo:capacityWh', [])).toBe(false)
  })
})
