// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The sign-in button at the end of the passport, as a visitor
 * reads it once the restricted rows answer 401 with a login URL.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as host from '@/host'
import type { DppSnapshot } from '@/types'
import { fetchStateByVersion } from '@/private-properties'
import '@/components/dpp-private-signin'

function mount(): Element {
  const signin = document.createElement('dpp-private-signin')
  document.body.appendChild(signin)
  return signin
}

beforeEach(() => {
  document.body.replaceChildren()
  host.currentVersion.set(1)
  host.snapshots.set({ 1: {} as unknown as DppSnapshot })
  fetchStateByVersion.set({
    1: { status: 'unauth', loginUrl: '/en/passport/login' }
  })
})

describe('sign-in button', () => {
  it('names what signing in opens', () => {
    const button = mount().querySelector('.dpp-properties-affordance')
    expect(button?.textContent?.trim()).
      toBe('Sign in for additional product data')
  })

  // The functional key glyph is bundled, so it draws on a host
  // that ships no content sprite, as on the staff bar.
  it('opens with the functional key glyph', () => {
    const button = mount().querySelector('.dpp-properties-affordance')
    const glyph = button?.firstElementChild
    expect(glyph?.localName).toBe('svg')
    expect(glyph?.classList.contains('icon--fn')).toBe(true)
    expect(glyph?.querySelector('use')?.getAttribute('href')).toBe('#icon-key')
  })
})
