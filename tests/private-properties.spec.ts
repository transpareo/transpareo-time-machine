/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Login-URL reader + same-registrable-site guard for the
 * private-properties read path. Authentication is a full-page
 * hand-off: a 401 from the endpoint names a login URL via
 * X-Auth-Url, and the sign-in affordance redirects the whole
 * page there. parseLoginUrl is the sole decoder for that
 * header; it must return null when the header is absent and
 * drop a login URL that resolves off the page's registrable
 * site (an open-redirect guard for a full-page navigation).
 *
 * isSameRegistrableSite is the underlying cross-host guard,
 * applied to both the read URL and the login URL; tested here
 * against the deployment shapes the design names (same-origin,
 * dpp_host subdomain, third-party embed).
 *
 * The fetch + cache + redirect paths depend on host signals,
 * global fetch, and window.location, and are covered by the
 * playwright integration probe rather than these unit tests.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseLoginUrl, isSameRegistrableSite,
  fetchPrivateRows, fetchStateByVersion,
} from '../src/private-properties'

const verifyDpp = vi.fn()
const dppIsAuthentic = vi.fn()
vi.mock('../src/crypto/dispatch', () => ({
  verifyDpp: (...args: unknown[]) => verifyDpp(...args),
  dppIsAuthentic: (...args: unknown[]) => dppIsAuthentic(...args),
}))

function res(
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(null, { status, headers })
}

describe('parseLoginUrl', () => {
  it('returns null when X-Auth-Url is missing', () => {
    expect(parseLoginUrl(res(401, {}))).toBeNull()
  })

  it('returns the login URL from X-Auth-Url', () => {
    // No window stub: the cross-site guard is a no-op outside a
    // browser, so a same-origin path passes through unchanged.
    expect(parseLoginUrl(res(401, { 'X-Auth-Url': '/api/authority/login' })))
      .toBe('/api/authority/login')
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

describe('parseLoginUrl: cross-site guard', () => {
  // The sign-in affordance navigates the whole page to this
  // URL, so parseLoginUrl drops a target that resolves off the
  // page's registrable site (open-redirect protection).
  afterEach(() => vi.unstubAllGlobals())

  const onPage = (hostname: string): void => {
    vi.stubGlobal('window', {
      location: { href: `https://${hostname}/dpp`, hostname },
    })
  }

  it('drops an absolute cross-site login URL', () => {
    onPage('acme.com')
    expect(parseLoginUrl(res(401, { 'X-Auth-Url': 'https://evil.example/login' })))
      .toBeNull()
  })

  it('allows a same-site (subdomain) absolute login URL', () => {
    onPage('acme.com')
    expect(parseLoginUrl(res(401, { 'X-Auth-Url': 'https://auth.acme.com/login' })))
      .toBe('https://auth.acme.com/login')
  })

  it('allows a relative login URL', () => {
    onPage('acme.com')
    expect(parseLoginUrl(res(401, { 'X-Auth-Url': '/login' })))
      .toBe('/login')
  })
})

describe('fetchPrivateRows: verification gate + wire shape', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  // The endpoint returns the full derived credential; rows
  // live at credentialSubject.product.properties, not at a
  // bare top-level `properties` key.
  function derivedCredentialBody(): unknown {
    return {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      credentialSubject: {
        product: {
          properties: [
            {
              '@type': 'PropertyValue', propertyID: 'a:public',
              name: { en: 'Public' }, value: 'x',
            },
            {
              '@type': 'PropertyValue', propertyID: 'a:secret',
              name: { en: 'Secret' }, value: 'y',
              access: 'legitimateInterest',
            },
          ],
        },
      },
      proof: [{ type: 'DataIntegrityProof', cryptosuite: 'ecdsa-sd-2023' }],
    }
  }

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }

  it('renders rows from credentialSubject.product.properties when the proof verifies', async () => {
    vi.stubGlobal('window', { location: { href: 'https://acme.com/dpp', hostname: 'acme.com' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(derivedCredentialBody())))
    verifyDpp.mockResolvedValue({ cryptosuite: 'ecdsa-sd-2023', results: [] })
    dppIsAuthentic.mockReturnValue(true)

    const status = await fetchPrivateRows(1, '/api/private/1')

    expect(status).toBe('ok')
    const state = fetchStateByVersion.peek()[1]
    expect(state?.status).toBe('ok')
    if (state?.status === 'ok') {
      expect(state.rows.map((r) => r.key)).toEqual(['a:secret'])
    }
  })

  it('fails closed to an error state when the derived proof does not verify, rendering nothing', async () => {
    vi.stubGlobal('window', { location: { href: 'https://acme.com/dpp', hostname: 'acme.com' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(derivedCredentialBody())))
    verifyDpp.mockResolvedValue({ cryptosuite: 'ecdsa-sd-2023', results: [] })
    dppIsAuthentic.mockReturnValue(false)

    const status = await fetchPrivateRows(1, '/api/private/1')

    expect(status).toBe('error')
    expect(fetchStateByVersion.peek()[1]?.status).toBe('error')
  })
})
