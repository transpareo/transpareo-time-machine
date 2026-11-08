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
 * A 200 is a credential, judged by the public snapshot's gates
 * and bound to the version's public snapshot before any row
 * renders. Those specs run the real verifier over the
 * production specimen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildEcdsaSdIssuer } from '../scripts/seed/ecdsa-sd-signing'
import {
  parseLoginUrl, isSameRegistrableSite,
  fetchPrivateRows, fetchStateByVersion, resetPrivateState,
  bootstrapPrivateRowsFetch, type PrivateFetchState,
} from '../src/private-properties'
import { config } from '../src/config'
import * as host from '../src/host'
import { revocationStatus } from '../src/revoked-roots'
import { encodeMultibaseBase58 } from '../src/crypto/multibase'
import type { DppManifest, SignedSnapshot } from '../src/archive'

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

describe('fetchPrivateRows: status branching', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  // A static copy has no signed-in reader and no endpoint of
  // its own: the address a manifest names belongs to the
  // running app the copy was made from.
  it('never fetches under archived-at', async () => {
    vi.stubGlobal('window', { location: { href: 'https://acme.com/dpp', hostname: 'acme.com' } })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    Object.assign(config, { archivedAt: '2026-10-08' })

    try {
      await fetchPrivateRows(7, '/api/private/7')
    } finally {
      Object.assign(config, { archivedAt: undefined })
    }

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(fetchStateByVersion.peek()[7]).toBeUndefined()
  })

  // A 401 says the reader has no session, which holds for
  // every version of the passport: asking again per version
  // only adds a failed request to the console each time.
  it('answers a later version from an earlier 401 without fetching', async () => {
    vi.stubGlobal('window', { location: { href: 'https://acme.com/dpp', hostname: 'acme.com' } })
    const unauth = res(401, { 'X-Auth-Url': '/en/passport/login' })
    const fetchSpy = vi.fn().mockResolvedValue(unauth)
    vi.stubGlobal('fetch', fetchSpy)

    try {
      await fetchPrivateRows(5, '/api/private/5')
      const status = await fetchPrivateRows(4, '/api/private/4')

      expect(status).toBe('unauth')
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      expect(fetchStateByVersion.peek()[4])
        .toEqual({ status: 'unauth', loginUrl: '/en/passport/login' })
    } finally {
      resetPrivateState()
    }
  })

  // A host naming its sign-in page lets the renderer show the
  // button without a request that answers 401 to everyone who
  // never signed in. It asks only while the host marks a
  // session: the reader cookie its sign-in sets, or the staff
  // link the back office stores while an operator is signed in.
  describe('with a sign-in-url', () => {
    const LOGIN = 'https://acme.com/passport/login'

    function onPage(cookie: string, staffLink: string | null): void {
      vi.stubGlobal('window', {
        location: { href: 'https://acme.com/dpp', hostname: 'acme.com' },
        localStorage: { getItem: () => staffLink },
      })
      vi.stubGlobal('document', { cookie })
    }

    function withSignIn(url: string, run: () => Promise<void>) {
      return async () => {
        Object.assign(config, { signInUrl: url })
        try {
          await run()
        } finally {
          Object.assign(config, { signInUrl: undefined })
          resetPrivateState()
        }
      }
    }

    it('offers the sign-in without asking when no session is marked', withSignIn(LOGIN, async () => {
      onPage('theme=dark', null)
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)

      const status = await fetchPrivateRows(3, '/api/private/3')

      expect(status).toBe('unauth')
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(fetchStateByVersion.peek()[3])
        .toEqual({ status: 'unauth', loginUrl: LOGIN })
    }))

    it('asks while the reader cookie is set', withSignIn(LOGIN, async () => {
      onPage('theme=dark; transpareo_passport_reader=1', null)
      const fetchSpy = vi.fn().mockResolvedValue(res(204, {}))
      vi.stubGlobal('fetch', fetchSpy)

      const status = await fetchPrivateRows(3, '/api/private/3')

      expect(status).toBe('empty')
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    }))

    it('asks while an operator staff link is stored', withSignIn(LOGIN, async () => {
      onPage('', '/admin/dpps/resolve')
      const fetchSpy = vi.fn().mockResolvedValue(res(204, {}))
      vi.stubGlobal('fetch', fetchSpy)

      await fetchPrivateRows(3, '/api/private/3')

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    }))

    it('drops a cross-site sign-in address, showing no button', withSignIn('https://evil.example/login', async () => {
      onPage('', null)
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)

      await fetchPrivateRows(3, '/api/private/3')

      expect(fetchSpy).not.toHaveBeenCalled()
      expect(fetchStateByVersion.peek()[3]).toEqual({ status: 'unauth' })
    }))
  })

})

// The production specimen: `view` is a reader's derived view
// of a v3 credential, revealing one legitimateInterest row
// (propertyID 2); `public_view` is the public snapshot of the
// same credential. Both carry the issuer proof and the
// platform counter-signature, under the two keys listed.
interface Specimen {
  readonly view: Record<string, unknown>
  readonly public_view: Record<string, unknown>
  readonly issuer_multikeys_b64: ReadonlyArray<string>
}

const SPECIMEN = JSON.parse(readFileSync(fileURLToPath(
  new URL('./fixtures/ecdsa-sd-prod-specimen.json', import.meta.url),
), 'utf8')) as Specimen

const [ISSUER_KEY, PLATFORM_KEY] = SPECIMEN.issuer_multikeys_b64
  .map((b64) => encodeMultibaseBase58(Buffer.from(b64, 'base64')))

// An Ed25519 key, as a build pins for the manifest signature.
const OTHER_KEY = 'z6MkkXFYBvMjeXkh4xBubXGz3n8ByWLZmVu9me6zXqZJSZF4'

const PAGE = {
  location: { href: 'https://acme.com/dpp', hostname: 'acme.com' },
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

// A copy of a credential whose subject differs by `patch`.
function withSubject(
  credential: Record<string, unknown>, patch: Record<string, unknown>,
): SignedSnapshot {
  const subject = credential.credentialSubject as Record<string, unknown>
  return {
    ...credential, credentialSubject: { ...subject, ...patch },
  } as unknown as SignedSnapshot
}

function pin(
  platform: ReadonlyArray<string> | undefined,
  issuer: ReadonlyArray<string> | undefined,
): void {
  Object.assign(config, {
    pinnedPlatformKeys: platform, pinnedIssuerKeys: issuer,
  })
}

describe('fetchPrivateRows: the public snapshot\'s gates', () => {
  const URL_3 = '/api/private/3'

  // The page shows v3 of the specimen's passport, under a build
  // that pins both of its keys, so no key document is read.
  beforeEach(() => {
    vi.stubGlobal('window', PAGE)
    pin([PLATFORM_KEY], [ISSUER_KEY])
    host.rawSnapshots.set({ 3: SPECIMEN.public_view as SignedSnapshot })
    revocationStatus.set('ok')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    pin(undefined, undefined)
    host.rawSnapshots.set({})
    revocationStatus.set('pending')
    resetPrivateState()
  })

  // The endpoint at `url` answers with `body`; any other read,
  // a key document among them, finds nothing.
  function serve(url: string, body: unknown): void {
    vi.stubGlobal('fetch', vi.fn(async (asked: string) => (
      asked === url ? jsonResponse(body) : new Response(null, { status: 404 })
    )))
  }

  function rowKeys(version: number): ReadonlyArray<string> {
    const state = fetchStateByVersion.peek()[version]
    return state?.status === 'ok' ? state.rows.map((r) => r.key) : []
  }

  it('renders the legitimateInterest rows of a credential naming this passport', async () => {
    serve(URL_3, SPECIMEN.view)

    expect(await fetchPrivateRows(3, URL_3)).toBe('ok')
    expect(rowKeys(3)).toEqual(['2'])
  })

  it('renders nothing when a proof does not verify', async () => {
    const product = (SPECIMEN.view.credentialSubject as {
      product: { properties: ReadonlyArray<Record<string, unknown>> }
    }).product
    const forged = product.properties.map((p) => (
      p.propertyID === '2' ? { ...p, value: 'Forged Chemicals Ltd' } : p
    ))
    serve(URL_3, withSubject(SPECIMEN.view, {
      product: { ...product, properties: forged },
    }))

    expect(await fetchPrivateRows(3, URL_3)).toBe('error')
    expect(fetchStateByVersion.peek()[3]?.status).toBe('error')
  })

  // A genuine credential proves who signed it, not which page
  // asked for it: one of another passport, issuer or version
  // must not land its rows here.
  describe('bound to the version\'s public snapshot', () => {
    it('rejects the credential of another passport', async () => {
      host.rawSnapshots.set({
        3: withSubject(SPECIMEN.public_view, {
          '@id': 'https://dpp.acme-corp.com/dpp/other999',
        }),
      })
      serve(URL_3, SPECIMEN.view)

      expect(await fetchPrivateRows(3, URL_3)).toBe('error')
      expect(rowKeys(3)).toEqual([])
    })

    it('rejects the credential of another issuer', async () => {
      const issuer = (SPECIMEN.public_view.credentialSubject as {
        issuer: Record<string, unknown>
      }).issuer
      host.rawSnapshots.set({
        3: withSubject(SPECIMEN.public_view, {
          issuer: { ...issuer, did: 'did:web:other.example' },
        }),
      })
      serve(URL_3, SPECIMEN.view)

      expect(await fetchPrivateRows(3, URL_3)).toBe('error')
      expect(rowKeys(3)).toEqual([])
    })

    it('rejects the credential of another version', async () => {
      host.rawSnapshots.set({
        2: withSubject(SPECIMEN.public_view, { version: 2 }),
      })
      serve('/api/private/2', SPECIMEN.view)

      expect(await fetchPrivateRows(2, '/api/private/2')).toBe('error')
      expect(rowKeys(2)).toEqual([])
    })

    it('rejects a credential while the version has no public snapshot', async () => {
      host.rawSnapshots.set({})
      serve(URL_3, SPECIMEN.view)

      expect(await fetchPrivateRows(3, URL_3)).toBe('error')
      expect(rowKeys(3)).toEqual([])
    })
  })

  // Every proof verifies under one of the pinned keys here;
  // what fails is the requirement that one verified proof sits
  // under each pinned set.
  describe('pinned keys', () => {
    it('rejects a credential no pinned platform key signed', async () => {
      pin([OTHER_KEY], [ISSUER_KEY, PLATFORM_KEY])
      serve(URL_3, SPECIMEN.view)

      expect(await fetchPrivateRows(3, URL_3)).toBe('error')
      expect(rowKeys(3)).toEqual([])
    })

    it('rejects a credential no declared issuer key signed', async () => {
      pin([PLATFORM_KEY, ISSUER_KEY], [OTHER_KEY])
      serve(URL_3, SPECIMEN.view)

      expect(await fetchPrivateRows(3, URL_3)).toBe('error')
      expect(rowKeys(3)).toEqual([])
    })
  })

  it.each(['revoked', 'unreachable'] as const)(
    'renders nothing while the pinned platform key is %s',
    async (status) => {
      revocationStatus.set(status)
      serve(URL_3, SPECIMEN.view)

      expect(await fetchPrivateRows(3, URL_3)).toBe('error')
      expect(rowKeys(3)).toEqual([])
    },
  )
})

// A reader's view of a credential minted here, with the
// seed's two keys pinned: the restricted rows of both reader
// tiers and a manufacturer behind a tier, beside a public
// row the public snapshot paints already.
describe('fetchPrivateRows: what a reader\'s view serves', () => {
  const URL_4 = '/api/private/4'
  const PAGE_ID = 'https://acme.example/dpp/abc12345'
  const ISSUER = {
    '@type': 'Organization', name: 'Acme', did: 'did:web:acme.example'
  }

  function propertyRow(
    propertyID: string, value: string, access?: string
  ): Record<string, unknown> {
    const tier = access ? { access } : {}
    return {
      '@type': 'PropertyValue', propertyID, name: propertyID, value, ...tier
    }
  }

  // The issuer writes its key documents into `dir`, and the
  // pins are read from there; nothing reads it once minted.
  async function mint(
    manufacturer: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const dir = mkdtempSync(join(tmpdir(), 'sd-'))
    try {
      const issuer = await buildEcdsaSdIssuer(
        dir, 'acme', 'abc12345', '2026-11-06T12:00:00Z',
        ISSUER.did, 'did:web:platform.example'
      )
      const keys = join(dir, 'acme/dpp/abc12345/keys')
      const multikey = (file: string): string => (JSON.parse(
        readFileSync(join(keys, file), 'utf8')
      ) as { publicKeyMultibase: string }).publicKeyMultibase
      pin([multikey('platform-p256.json')], [multikey('issuer-p256.json')])

      const properties = [
        propertyRow('origin', 'Germany'),
        propertyRow('recycled', '12 %', 'onDemand'),
        propertyRow('supplier', 'Acme Chemicals GmbH', 'legitimateInterest')
      ]
      return await issuer.issue({
        '@id': PAGE_ID,
        version: 4,
        issuer: ISSUER,
        product: {
          '@type': 'Product', name: 'Pulse 2000', manufacturer, properties
        }
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  const VOLTWERK = {
    '@type': 'Organization', name: 'Voltwerk AG', city: 'Zug',
    propertyID: 'manufacturer'
  }

  beforeEach(() => {
    vi.stubGlobal('window', PAGE)
    revocationStatus.set('ok')
    const subject = { '@id': PAGE_ID, issuer: ISSUER, version: 4 }
    const snapshot = { credentialSubject: subject } as unknown
    host.rawSnapshots.set({ 4: snapshot as SignedSnapshot })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    pin(undefined, undefined)
    host.rawSnapshots.set({})
    revocationStatus.set('pending')
    resetPrivateState()
  })

  async function read(view: Record<string, unknown>): Promise<unknown> {
    vi.stubGlobal('fetch', vi.fn(async (asked: string) => (
      asked === URL_4 ? jsonResponse(view) : new Response(null, { status: 404 })
    )))
    return fetchPrivateRows(4, URL_4)
  }

  function okState(): Extract<PrivateFetchState, { status: 'ok' }> {
    const state = fetchStateByVersion.peek()[4]
    if (state?.status !== 'ok') throw new Error(`state is ${state?.status}`)
    return state
  }

  it('serves the onDemand and legitimateInterest rows', async () => {
    const view = await mint({ ...VOLTWERK, access: 'legitimateInterest' })

    expect(await read(view)).toBe('ok')
    expect(okState().rows.map((r) => r.key)).toEqual(['recycled', 'supplier'])
  })

  it.each(['legitimateInterest', 'onDemand'])(
    'takes a %s manufacturer for the address strip',
    async (access) => {
      const view = await mint({ ...VOLTWERK, access })

      await read(view)
      expect(okState().manufacturer).
        toMatchObject({ name: 'Voltwerk AG', city: 'Zug' })
    }
  )

  it('leaves a public manufacturer to the snapshot', async () => {
    const { propertyID: _, ...organization } = VOLTWERK
    const view = await mint(organization)

    await read(view)
    expect(okState().manufacturer).toBeUndefined()
  })
})

// A new `src` reboots the page and clears the private state,
// and the new passport's version numbers collide with the old
// one's. A read still in flight for the passport before must
// leave the fresh state alone, whatever it answers.
describe('fetchPrivateRows: a reboot mid-read', () => {
  const URL_3 = '/api/private/3'
  let answer: (res: Response) => void
  let fail: (err: unknown) => void

  beforeEach(() => {
    vi.stubGlobal('window', PAGE)
    pin([PLATFORM_KEY], [ISSUER_KEY])
    host.rawSnapshots.set({ 3: SPECIMEN.public_view as SignedSnapshot })
    revocationStatus.set('ok')
    vi.stubGlobal('fetch', vi.fn((asked: string) => (
      asked === URL_3
        ? new Promise<Response>((resolve, reject) => {
          answer = resolve
          fail = reject
        })
        : Promise.resolve(new Response(null, { status: 404 }))
    )))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    pin(undefined, undefined)
    host.rawSnapshots.set({})
    revocationStatus.set('pending')
    resetPrivateState()
  })

  // What the element does on a new `src`.
  async function reboot(): Promise<void> {
    await host.bootFrom('https://cdn.test/other/manifest.json')
    resetPrivateState()
  }

  it('drops a 401, which keeps the new passport\'s rows', async () => {
    const read = fetchPrivateRows(3, URL_3)
    await reboot()
    const rows: PrivateFetchState = { status: 'ok', rows: [] }
    fetchStateByVersion.set({ 2: rows })

    answer(res(401, { 'X-Auth-Url': '/login' }))
    await read

    expect(fetchStateByVersion.peek()).toEqual({ 2: rows })
  })

  it('drops a credential, which sets no error', async () => {
    const read = fetchPrivateRows(3, URL_3)
    await reboot()

    answer(jsonResponse(SPECIMEN.view))
    await read

    expect(fetchStateByVersion.peek()).toEqual({})
  })

  // What the read says about the passport before is dropped
  // with it: the console hears nothing of it.
  function privateWarnings(): ReadonlyArray<ReadonlyArray<unknown>> {
    return vi.mocked(console.warn).mock.calls
      .filter(([first]) => String(first).startsWith('[private]'))
  }

  it.each([
    ['a failed request', () => fail(new TypeError('Failed to fetch'))],
    ['an HTTP error', () => answer(res(500, {}))],
    ['a cross-site sign-in', () => answer(
      res(401, { 'X-Auth-Url': 'https://evil.example/login' })
    )],
    ['a credential', () => answer(jsonResponse(SPECIMEN.view))]
  ])('drops %s unlogged', async (_, respond) => {
    const read = fetchPrivateRows(3, URL_3)
    await reboot()

    respond()
    await read

    expect(privateWarnings()).toEqual([])
  })

  // The answer came in before the reboot, which lands while
  // its body is read: what the read then finds wrong is about
  // the passport before.
  it('drops a credential whose body outlasts a reboot', async () => {
    let body: ((value: unknown) => void) | undefined
    const json = (): Promise<unknown> => new Promise((r) => { body = r })
    const read = fetchPrivateRows(3, URL_3)
    answer({ ok: true, status: 200, json } as unknown as Response)
    await vi.waitFor(() => expect(body).toBeDefined())

    await reboot()
    body?.(SPECIMEN.view)
    await read

    expect(privateWarnings()).toEqual([])
    expect(fetchStateByVersion.peek()).toEqual({})
  })

  it('logs what a read finds while the page stays', async () => {
    const read = fetchPrivateRows(3, URL_3)

    answer(res(500, {}))
    await read

    expect(privateWarnings()).
      toEqual([[`[private] HTTP 500 from ${URL_3}`]])
  })
})

// The rows are bound to the version's public snapshot and
// judged under a settled revocation check, so the request
// waits for both.
describe('bootstrapPrivateRowsFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    host.manifest.set(null)
    host.currentVersion.set(0)
    host.rawSnapshots.set({})
    revocationStatus.set('pending')
    resetPrivateState()
  })

  it('asks once the public snapshot is in and the revocation check settled', () => {
    vi.stubGlobal('window', PAGE)
    const fetchSpy = vi.fn().mockResolvedValue(res(204, {}))
    vi.stubGlobal('fetch', fetchSpy)
    host.manifest.set({
      versions: [{ number: 3, privateProperties: { url: '/api/private/3' } }],
    } as unknown as DppManifest)
    host.currentVersion.set(3)

    bootstrapPrivateRowsFetch()
    expect(fetchSpy).not.toHaveBeenCalled()

    host.rawSnapshots.set({ 3: SPECIMEN.public_view as SignedSnapshot })
    expect(fetchSpy).not.toHaveBeenCalled()

    revocationStatus.set('ok')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
