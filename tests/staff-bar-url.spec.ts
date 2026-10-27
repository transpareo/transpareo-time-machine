// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where the staff bar links: the address the publisher's own
 * back office stored for this origin, with the passport's code
 * added. The value comes from storage any script on the origin
 * can write, so it is held to the page's own origin.
 */

import { describe, it, expect } from 'vitest'
import { staffBarHref } from '@/components/dpp-staff-bar'

const PAGE = 'https://demo.example/dpp/abc123'

describe('staffBarHref', () => {
  it('adds the code to the stored path', () => {
    expect(staffBarHref('/admin/dpps/resolve', 'abc123', PAGE))
      .toBe('https://demo.example/admin/dpps/resolve?code=abc123')
  })

  it('keeps a query the stored address already has', () => {
    const href = staffBarHref('/en/admin/open?x=1', 'abc', PAGE)
    expect(href).toBe('https://demo.example/en/admin/open?x=1&code=abc')
  })

  it('escapes the code', () => {
    const href = staffBarHref('/admin/dpps/resolve', 'a&b c', PAGE)
    expect(href).toBe('https://demo.example/admin/dpps/resolve?code=a%26b+c')
  })

  it('takes an absolute address on the same origin', () => {
    const stored = 'https://demo.example/admin/dpps/resolve'
    expect(staffBarHref(stored, 'abc', PAGE))
      .toBe('https://demo.example/admin/dpps/resolve?code=abc')
  })

  it('refuses an address on another origin', () => {
    const stored = 'https://elsewhere.example/admin'
    expect(staffBarHref(stored, 'abc', PAGE)).toBeNull()
    expect(staffBarHref('//elsewhere.example/admin', 'abc', PAGE)).toBeNull()
  })

  it('refuses a script address', () => {
    expect(staffBarHref('javascript:alert(1)', 'abc', PAGE)).toBeNull()
  })

  it('draws nothing without a stored address or a code', () => {
    expect(staffBarHref(null, 'abc', PAGE)).toBeNull()
    expect(staffBarHref('', 'abc', PAGE)).toBeNull()
    expect(staffBarHref('/admin/dpps/resolve', '', PAGE)).toBeNull()
  })
})
