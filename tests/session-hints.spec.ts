/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The staff link the publisher's back office stores on the
 * passport's origin: a JSON record naming the address of its
 * lookup by code and the wording of the link, both its own.
 * Anything short of that draws no bar, since the renderer has
 * no wording of its own to fall back on.
 */

import { describe, it, expect } from 'vitest'
import { parseStaffLink } from '@/session-hints'

const URL = '/admin/dpps/resolve?code={code}'

function stored(record: unknown): string {
  return JSON.stringify(record)
}

describe('parseStaffLink', () => {
  it('reads the address and the wording', () => {
    const raw = stored({ url: URL, label: 'Edit in back office' })
    expect(parseStaffLink(raw))
      .toEqual({ url: URL, label: 'Edit in back office' })
  })

  it('trims the wording', () => {
    const raw = stored({ url: URL, label: '  Edit  ' })
    expect(parseStaffLink(raw)?.label).toBe('Edit')
  })

  it('reads nothing from an empty store', () => {
    expect(parseStaffLink(null)).toBeNull()
    expect(parseStaffLink('')).toBeNull()
  })

  it('reads nothing from a bare address', () => {
    expect(parseStaffLink('/admin/dpps/resolve')).toBeNull()
  })

  it('reads nothing from JSON that is no record', () => {
    for (const raw of ['"x"', '42', 'null', '[]', 'true']) {
      expect(parseStaffLink(raw)).toBeNull()
    }
  })

  it('reads nothing without wording', () => {
    expect(parseStaffLink(stored({ url: URL }))).toBeNull()
    expect(parseStaffLink(stored({ url: URL, label: ' ' }))).toBeNull()
    expect(parseStaffLink(stored({ url: URL, label: 7 }))).toBeNull()
  })

  it('reads nothing without an address', () => {
    expect(parseStaffLink(stored({ label: 'Edit' }))).toBeNull()
    expect(parseStaffLink(stored({ url: 7, label: 'Edit' }))).toBeNull()
  })

  it('reads nothing from an address without a place for the code', () => {
    const raw = stored({ url: '/admin/dpps/resolve', label: 'Edit' })
    expect(parseStaffLink(raw)).toBeNull()
  })
})
