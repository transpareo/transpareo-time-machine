/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Coverage for getPages(currentPage, totalPages), the
 * gallery pagination layout. The function is small in
 * lines but algorithmically dense (nested splice +
 * ellipsis promotion); it warrants regression tests so
 * a refactor doesn't silently move where the dots go.
 *
 * Each case asserts the visible row in the order it
 * gets painted, with literal `'...'` for ellipses. The
 * cap is 7 visible cells, including the first and last
 * page numbers and any ellipses.
 */
import { describe, expect, it } from 'vitest'
import { getPages } from '../src/pagination'

describe('getPages', () => {
  it('returns [] for zero or one total page', () => {
    expect(getPages(1, 0)).toEqual([])
    expect(getPages(1, 1)).toEqual([])
  })

  it('lists every page when the total fits the cap', () => {
    expect(getPages(1, 2)).toEqual([1, 2])
    expect(getPages(2, 5)).toEqual([1, 2, 3, 4, 5])
    expect(getPages(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('inserts a right ellipsis near the start of a long list', () => {
    expect(getPages(1, 12)).toEqual([1, 2, 3, 4, 5, '...', 12])
    expect(getPages(3, 12)).toEqual([1, 2, 3, 4, 5, '...', 12])
  })

  it('inserts a left ellipsis near the end of a long list', () => {
    expect(getPages(10, 12)).toEqual([1, '...', 8, 9, 10, 11, 12])
    expect(getPages(12, 12)).toEqual([1, '...', 8, 9, 10, 11, 12])
  })

  it('inserts two ellipses when the current page is mid-range', () => {
    expect(getPages(7, 20)).toEqual([1, '...', 6, 7, 8, '...', 20])
    expect(getPages(10, 20)).toEqual([1, '...', 9, 10, 11, '...', 20])
  })

  it('keeps the layout exactly seven cells wide on long lists', () => {
    for (let current = 1; current <= 20; current++) {
      const pages = getPages(current, 20)
      expect(
        pages.length,
        `current=${current} produced ${pages.length} cells`,
      ).toBe(7)
    }
  })

  it('never duplicates a page number across the row', () => {
    for (let current = 1; current <= 15; current++) {
      const pages = getPages(current, 15)
      const numbers = pages.filter(
        (p): p is number => typeof p === 'number',
      )
      expect(new Set(numbers).size).toBe(numbers.length)
    }
  })

  it('always pins page 1 first and total last when total > 1', () => {
    for (const total of [3, 7, 12, 20, 50]) {
      for (let current = 1; current <= total; current++) {
        const pages = getPages(current, total)
        expect(pages[0]).toBe(1)
        expect(pages[pages.length - 1]).toBe(total)
      }
    }
  })

  it('never places an ellipsis next to a one-page elision', () => {
    // An ellipsis between 1 and 2 (or between total-1
    // and total) would hide a single page; the layout
    // promotes that page to a literal number instead.
    // Across every current/total combination there
    // should be no `1, '...', 2` or `total-1, '...', total`
    // sequence in the output.
    for (let current = 1; current <= 20; current++) {
      const pages = getPages(current, 20)
      for (let i = 1; i < pages.length - 1; i++) {
        if (pages[i] !== '...') continue
        const before = pages[i - 1]
        const after = pages[i + 1]
        if (typeof before === 'number' && typeof after === 'number') {
          expect(
            after - before,
            `single-page elision at index ${i} for current=${current}`,
          ).toBeGreaterThan(1)
        }
      }
    }
  })
})
