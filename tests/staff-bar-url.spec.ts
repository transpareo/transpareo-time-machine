// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where the staff bar links: the address the publisher's own
 * back office stored for this origin, with the passport's code
 * in place of its `{code}`. The value comes from storage any
 * script on the origin can write, so it is held to the page's
 * own origin.
 */

import { describe, it, expect } from 'vitest'
import { staffBarHref } from '@/components/dpp-staff-bar'

const PAGE = 'https://demo.example/dpp/abc123'
const LOOKUP = '/admin/dpps/resolve?code={code}'

describe('staffBarHref', () => {
  it('puts the code into the query', () => {
    expect(staffBarHref(LOOKUP, 'abc123', PAGE))
      .toBe('https://demo.example/admin/dpps/resolve?code=abc123')
  })

  it('puts the code into the path', () => {
    const href = staffBarHref('/admin/passports/{code}/edit', 'abc', PAGE)
    expect(href).toBe('https://demo.example/admin/passports/abc/edit')
  })

  it('escapes the code', () => {
    const href = staffBarHref(LOOKUP, 'a&b c/d', PAGE)
    expect(href)
      .toBe('https://demo.example/admin/dpps/resolve?code=a%26b%20c%2Fd')
  })

  it('takes an absolute address on the same origin', () => {
    const stored = 'https://demo.example/admin/dpps/resolve?code={code}'
    expect(staffBarHref(stored, 'abc', PAGE))
      .toBe('https://demo.example/admin/dpps/resolve?code=abc')
  })

  it('refuses an address on another origin', () => {
    const stored = 'https://elsewhere.example/admin?code={code}'
    expect(staffBarHref(stored, 'abc', PAGE)).toBeNull()
    expect(staffBarHref('//elsewhere.example/{code}', 'abc', PAGE))
      .toBeNull()
  })

  it('refuses a code that moves the link to another host', () => {
    const stored = 'https://{code}/admin'
    expect(staffBarHref(stored, 'elsewhere.example', PAGE)).toBeNull()
  })

  it('refuses a script address', () => {
    expect(staffBarHref('javascript:alert("{code}")', 'abc', PAGE))
      .toBeNull()
  })

  it('draws nothing without a code', () => {
    expect(staffBarHref(LOOKUP, '', PAGE)).toBeNull()
  })
})
