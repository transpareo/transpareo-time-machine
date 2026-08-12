// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The one URL this SPA builds for a system it does not
 * control: the full-page hand-off to the authorising system's
 * login, behind the "sign in for additional product data"
 * affordance.
 *
 * It carries where to come back to, and which language the
 * visitor is reading the passport in, so the login page does
 * not answer a German passport in English, under the
 * `locale` name this platform uses elsewhere.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { locale } from '@/i18n'
import { signInUrl } from '@/components/dpp-private-signin'

const BACK = 'https://shop.example/p/42?v=3'

afterEach(() => locale.set('en'))

describe('signInUrl', () => {
  it('carries the return target and the active locale', () => {
    locale.set('de')
    expect(signInUrl('https://shop.example/login', BACK)).toBe(
      'https://shop.example/login'
      + '?return=https%3A%2F%2Fshop.example%2Fp%2F42%3Fv%3D3'
      + '&locale=de',
    )
  })

  it('appends to a login URL that already has a query', () => {
    locale.set('fr')
    const url = signInUrl('https://shop.example/login?next=1', BACK)
    expect(url).toContain('login?next=1&return=')
    expect(url.endsWith('&locale=fr')).toBe(true)
  })

  it('follows the locale the visitor switched to', () => {
    locale.set('it')
    expect(signInUrl('https://shop.example/login', BACK)).
      toContain('locale=it')
  })
})

describe('signInUrl: a login URL that names its own locale', () => {
  it('leaves an existing ui_locales alone', () => {
    locale.set('de')
    const url = signInUrl('https://shop.example/login?ui_locales=fr', BACK)
    expect(url).toContain('ui_locales=fr')
    expect(url).not.toContain('=de')
  })

  it('treats locale= and lang= as the same statement', () => {
    // Whoever issued the URL has said what language it wants,
    // and this is how a backend opts out of the parameter.
    locale.set('de')
    expect(signInUrl('https://shop.example/login?locale=fr', BACK)).
      not.toContain('=de')
    expect(signInUrl('https://shop.example/login?lang=fr', BACK)).
      not.toContain('=de')
  })

  it('does not mistake another parameter for a locale one', () => {
    locale.set('de')
    expect(signInUrl('https://shop.example/login?slang=x', BACK)).
      toContain('&locale=de')
  })
})
