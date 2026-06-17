/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * X-Auth-Fields challenge parser + same-registrable-
 * site guard. The private-properties endpoint returns
 * 401 + a set of X-Auth-* headers describing the form
 * the SPA's auth modal must render; parseChallenge is
 * the sole entry point for that header decoding and
 * has to tolerate missing optional headers, reject
 * malformed JSON without throwing, and surface
 * X-Auth-Stage / X-Auth-Error so the modal can
 * discriminate "advance to next stage" from "retry
 * current stage with feedback".
 *
 * isSameRegistrableSite is the cross-host phishing
 * guard the SPA applies before fetching
 * privateProperties.url; tested here against the
 * deployment shapes the design names (same-origin,
 * dpp_host subdomain, third-party embed).
 *
 * The stepped-auth + retry + token-in-body paths live
 * inside submitAuth and fetchPrivateRows, which depend
 * on host signals + global fetch and are covered by
 * the playwright integration probe rather than these
 * unit tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseChallenge, isSameRegistrableSite,
} from '../src/private-properties'

function res(
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(null, { status, headers })
}

const FIELDS_JSON = JSON.stringify([
  { name: 'email', type: 'email', required: true, label: 'Email' },
  { name: 'password', type: 'password', required: true, label: 'Password' },
])

describe('parseChallenge', () => {
  it('returns null when X-Auth-Url is missing', () => {
    const r = res(401, { 'X-Auth-Fields': FIELDS_JSON })
    expect(parseChallenge(r, 7, '/private')).toBeNull()
  })

  it('returns null when X-Auth-Fields is missing', () => {
    const r = res(401, { 'X-Auth-Url': '/auth' })
    expect(parseChallenge(r, 7, '/private')).toBeNull()
  })

  it('returns null when X-Auth-Fields is malformed JSON', () => {
    const r = res(401, {
      'X-Auth-Url': '/auth',
      'X-Auth-Fields': '{not-json',
    })
    expect(parseChallenge(r, 7, '/private')).toBeNull()
  })

  it('returns null when X-Auth-Fields decodes to non-array', () => {
    const r = res(401, {
      'X-Auth-Url': '/auth',
      'X-Auth-Fields': '{"name":"oops"}',
    })
    expect(parseChallenge(r, 7, '/private')).toBeNull()
  })

  it('parses a minimal challenge into a full descriptor', () => {
    const r = res(401, {
      'X-Auth-Url': '/auth',
      'X-Auth-Fields': FIELDS_JSON,
    })
    const ch = parseChallenge(r, 7, '/private')
    expect(ch).not.toBeNull()
    expect(ch?.url).toBe('/auth')
    expect(ch?.method).toBe('POST')
    expect(ch?.contentType).toBe('application/json')
    expect(ch?.fields).toHaveLength(2)
    expect(ch?.versionNumber).toBe(7)
    expect(ch?.privateUrl).toBe('/private')
    expect(ch?.error).toBeUndefined()
    expect(ch?.stage).toBe(1)
  })

  it('honours an explicit X-Auth-Method override', () => {
    const r = res(401, {
      'X-Auth-Url': '/auth',
      'X-Auth-Method': 'PUT',
      'X-Auth-Fields': FIELDS_JSON,
    })
    expect(parseChallenge(r, 1, '/private')?.method).toBe('PUT')
  })

  it('honours form-urlencoded content type', () => {
    const r = res(401, {
      'X-Auth-Url': '/auth',
      'X-Auth-Content-Type': 'application/x-www-form-urlencoded',
      'X-Auth-Fields': FIELDS_JSON,
    })
    expect(parseChallenge(r, 1, '/private')?.contentType)
      .toBe('application/x-www-form-urlencoded')
  })

  it('carries X-Auth-Error into the challenge for re-display', () => {
    const r = res(401, {
      'X-Auth-Url': '/auth',
      'X-Auth-Fields': FIELDS_JSON,
      'X-Auth-Error': 'Wrong password',
    })
    expect(parseChallenge(r, 1, '/private')?.error).toBe('Wrong password')
  })

  it('reads X-Auth-Stage and defaults to 1 when missing', () => {
    const r = res(401, {
      'X-Auth-Url': '/auth',
      'X-Auth-Stage': '2',
      'X-Auth-Fields': JSON.stringify([
        { name: 'otp', type: 'number', required: true, label: 'OTP' },
      ]),
    })
    expect(parseChallenge(r, 1, '/private')?.stage).toBe(2)

    const r2 = res(401, {
      'X-Auth-Url': '/auth',
      'X-Auth-Fields': FIELDS_JSON,
    })
    expect(parseChallenge(r2, 1, '/private')?.stage).toBe(1)
  })

  it('clamps non-positive / non-numeric X-Auth-Stage values to 1', () => {
    const cases = ['0', '-3', 'abc', '']
    for (const stage of cases) {
      const r = res(401, {
        'X-Auth-Url': '/auth',
        'X-Auth-Stage': stage,
        'X-Auth-Fields': FIELDS_JSON,
      })
      expect(parseChallenge(r, 1, '/private')?.stage).toBe(1)
    }
  })

  it('supports stepped auth (different fields on a fresh challenge)', () => {
    // A second-factor round reuses parseChallenge with
    // an OTP-only X-Auth-Fields payload; the parser
    // should accept any field shape, not just email +
    // password.
    const r = res(401, {
      'X-Auth-Url': '/auth',
      'X-Auth-Fields': JSON.stringify([
        { name: 'otp', type: 'number', required: true, label: 'One-time code' },
      ]),
    })
    const ch = parseChallenge(r, 1, '/private')
    expect(ch?.fields).toHaveLength(1)
    expect(ch?.fields[0].name).toBe('otp')
    expect(ch?.fields[0].type).toBe('number')
  })
})

describe('isSameRegistrableSite', () => {
  // Page hostname is passed explicitly so the test
  // doesn't depend on window.location; the runtime
  // callers feed it from window.location.hostname.
  it('accepts same hostname', () => {
    expect(isSameRegistrableSite('https://acme.com/api/x', 'acme.com'))
      .toBe(true)
  })

  it('accepts a candidate that is a subdomain of the page host', () => {
    expect(isSameRegistrableSite('https://api.acme.com/x', 'acme.com'))
      .toBe(true)
  })

  it('accepts a candidate that is the parent of the page host (dpp_host)', () => {
    expect(isSameRegistrableSite('https://acme.com/api/x', 'dpp.acme.com'))
      .toBe(true)
  })

  it('rejects an unrelated registrable domain', () => {
    expect(isSameRegistrableSite('https://attacker.com/x', 'acme.com'))
      .toBe(false)
  })

  it('rejects a host that masquerades as a suffix (acme.com vs evilacme.com)', () => {
    expect(isSameRegistrableSite('https://evilacme.com/x', 'acme.com'))
      .toBe(false)
  })

  it('rejects an attacker subdomain that contains the page host as a fragment', () => {
    expect(
      isSameRegistrableSite('https://acme.com.attacker.com/x', 'acme.com'),
    ).toBe(false)
  })

  it('rejects a bare-label host posing as the parent domain', () => {
    // Without the two-label requirement on the shorter
    // side, a page on foo.example.ai would accept an
    // endpoint at the registrable bare host `ai`.
    expect(isSameRegistrableSite('https://ai/x', 'foo.example.ai'))
      .toBe(false)
    expect(isSameRegistrableSite('https://com/x', 'acme.com'))
      .toBe(false)
  })

  it('still accepts a two-label parent of a deep page host', () => {
    expect(isSameRegistrableSite('https://example.ai/x', 'foo.example.ai'))
      .toBe(true)
  })

  it('rejects malformed URLs', () => {
    expect(isSameRegistrableSite('not a url', 'acme.com')).toBe(false)
  })

  it('rejects when the page hostname is empty', () => {
    // No window.location available (e.g. SSR), no auth
    // can possibly succeed; fail closed.
    expect(isSameRegistrableSite('https://acme.com/x', ''))
      .toBe(false)
  })

  it('is case-insensitive on hostnames', () => {
    expect(isSameRegistrableSite('https://API.acme.com/x', 'Acme.COM'))
      .toBe(true)
  })
})

describe('parseChallenge: X-Auth-Url cross-site guard', () => {
  // The credential POST runs with credentials:'include', so
  // parseChallenge drops a challenge whose action URL would
  // resolve off the page's registrable site.
  afterEach(() => vi.unstubAllGlobals())

  const onPage = (hostname: string): void => {
    vi.stubGlobal('window', {
      location: { href: `https://${hostname}/dpp`, hostname },
    })
  }

  it('drops an absolute cross-site X-Auth-Url', () => {
    onPage('acme.com')
    const r = res(401, {
      'X-Auth-Url': 'https://evil.example/collect',
      'X-Auth-Fields': FIELDS_JSON,
    })
    expect(parseChallenge(r, 1, '/private')).toBeNull()
  })

  it('allows a same-site (subdomain) absolute X-Auth-Url', () => {
    onPage('acme.com')
    const r = res(401, {
      'X-Auth-Url': 'https://auth.acme.com/login',
      'X-Auth-Fields': FIELDS_JSON,
    })
    expect(parseChallenge(r, 1, '/private')).not.toBeNull()
  })

  it('allows a relative X-Auth-Url', () => {
    onPage('acme.com')
    const r = res(401, {
      'X-Auth-Url': '/login',
      'X-Auth-Fields': FIELDS_JSON,
    })
    expect(parseChallenge(r, 1, '/private')).not.toBeNull()
  })
})
