// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The standalone <dpp-verifier> widget, driven the way a
 * visitor drives it: paste a manifest URL, get a verdict
 * card. Two regressions are pinned here.
 *
 * The widget used to call the eddsa-jcs verifier directly, so
 * an ecdsa-sd-2023 passport failed with "bad signature
 * encoding: not a z-prefixed multibase string" on every
 * proof (an ecdsa-sd proofValue is base64url CBOR, not
 * base58). It routes through the cryptosuite dispatch now, so
 * either suite verifies.
 *
 * The widget renders into its own shadow root, where a bare
 * `<use href="#icon-ok">` cannot reach a sprite injected
 * anywhere else, so its verdict orbs came out as empty
 * circles. It installs the bundled functional sprite into its
 * own root now.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEcdsaSdIssuer } from '../scripts/seed/ecdsa-sd-signing'
import '@/components/dpp-verifier'

const HANDLE = 'acme'
const CODE = 'abc12345'
const ISSUER_DID = 'did:web:acme.example'
const PLATFORM_DID = 'did:web:platform.example'
const ORIGIN = 'https://cdn.example'
const MANIFEST_URL = `${ORIGIN}/${HANDLE}/dpp/${CODE}/manifest.json`

let keysDir: string
let credential: Record<string, unknown>

// A real single-version ecdsa-sd DPP: the seed issuer mints
// the credential and writes each authority's P-256 Multikey
// document, which the stubbed fetch then serves.
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'verifier-widget-'))
  keysDir = join(dir, HANDLE, 'dpp', CODE, 'keys')
  const issuer = await buildEcdsaSdIssuer(
    dir, HANDLE, CODE, '2026-05-01T12:00:00Z', ISSUER_DID, PLATFORM_DID,
  )
  credential = await issuer.issue({
    '@context': ['ignored'],
    '@type': 'dpp:DigitalProductPassport',
    '@id': `https://acme.example/dpp/${CODE}`,
    passportAlias: CODE,
    version: 1,
    publishedAt: '2026-05-01T12:00:00Z',
    product: {
      '@type': 'Product',
      name: 'Pulse 2000',
      properties: [{
        '@type': 'PropertyValue', propertyID: 'capacity',
        name: 'Capacity', value: '2.0'
      }]
    }
  })
})

function manifest(): Record<string, unknown> {
  return {
    '@type': 'DppManifest',
    code: CODE,
    currentVersion: 1,
    issuer: { '@type': 'Organization', name: 'Acme', did: ISSUER_DID },
    platform: {
      '@type': 'Organization', name: 'Transpareo', did: PLATFORM_DID
    },
    versions: [{ number: 1, url: 'v/1.json', hashValue: 'h1' }]
  }
}

// Serves the manifest, the credential and the two key
// documents; anything else 404s so a missed route shows up as
// a failure rather than a silent pass.
function stubFetch(): void {
  vi.stubGlobal('fetch', async (input: string | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.endsWith('/manifest.json')) return json(manifest())
    if (url.endsWith('/v/1.json')) return json(credential)
    const key = /\/keys\/([a-z0-9-]+\.json)$/.exec(url)?.[1]
    if (key) {
      return new Response(await readFile(join(keysDir, key), 'utf8'), {
        status: 200
      })
    }
    return new Response('not found', { status: 404 })
  })
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

async function mountWidget(
  pins?: string, src = MANIFEST_URL,
): Promise<Element> {
  const widget = document.createElement('dpp-verifier')
  widget.setAttribute('src', src)
  if (pins) widget.setAttribute('pinned-platform-key', pins)
  document.body.appendChild(widget)
  await settle()
  return widget
}

function authorityLabels(widget: Element): string[] {
  return [...(widget.shadowRoot?.
    querySelectorAll('.verifier-authority-label') ?? [])].
    map((n) => n.textContent ?? '')
}

async function platformKey(): Promise<string> {
  const doc = JSON.parse(
    await readFile(join(keysDir, 'platform-p256.json'), 'utf8'),
  ) as { publicKeyMultibase: string }
  return doc.publicKeyMultibase
}

// The widget's run() is a chain of awaits with no completion
// signal; poll its shadow root until the result card lands.
async function settle(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 5))
    const mount = document.querySelector('dpp-verifier')?.shadowRoot
    const done = mount?.querySelector(
      '.verifier-card, .verifier-error, .verifier-unverifiable',
    )
    if (done) return
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('dpp-verifier: ecdsa-sd passports', () => {
  it('verifies a derived-proof credential as authentic', async () => {
    stubFetch()
    const widget = await mountWidget()
    const card = widget.shadowRoot?.querySelector('.verifier-card')
    expect(card?.className).toContain('verdict-authentic')
  })

  it('never reports the base58 decode error on an sd proof', async () => {
    stubFetch()
    const widget = await mountWidget()
    expect(widget.shadowRoot?.textContent ?? '').
      not.toContain('z-prefixed multibase')
  })

  it('attributes the two proofs to the declared authorities', async () => {
    stubFetch()
    const widget = await mountWidget()
    expect(authorityLabels(widget)).toEqual(['Acme', 'Transpareo'])
  })
})

describe('dpp-verifier: attribution under pinned keys', () => {
  it('attributes both authorities when no pin matches', async () => {
    // A foreign DPP on a pinning host page: its proofs match
    // no pin, which says nothing about who signed them. They
    // still belong to that DPP's own issuer and platform.
    stubFetch()
    const widget = await mountWidget('zStrangerPlatformKey')
    expect(authorityLabels(widget)).toEqual(['Acme', 'Transpareo'])
  })

  it('keeps one card per authority when no pin matches', async () => {
    // The old split - pinned entries are the platform, every
    // other entry is the issuer - folded both proofs into a
    // single issuer card here.
    stubFetch()
    const widget = await mountWidget('zStrangerPlatformKey')
    expect(widget.shadowRoot?.querySelectorAll('.verifier-authority')).
      toHaveLength(2)
  })

  it('attributes the same way when the pin does match', async () => {
    stubFetch()
    const widget = await mountWidget(await platformKey())
    expect(authorityLabels(widget)).toEqual(['Acme', 'Transpareo'])
  })
})

describe('dpp-verifier: status icons', () => {
  it('installs the functional sprite into its own shadow root', async () => {
    stubFetch()
    const widget = await mountWidget()
    expect(widget.shadowRoot?.querySelector('symbol#icon-ok')).not.toBeNull()
    expect(widget.shadowRoot?.querySelector('symbol#icon-cancel')).
      not.toBeNull()
  })

  it('renders a resolvable glyph inside every verdict orb', async () => {
    stubFetch()
    const widget = await mountWidget()
    const root = widget.shadowRoot!
    const uses = [...root.querySelectorAll('.orb use')]
    expect(uses.length).toBeGreaterThan(0)
    for (const use of uses) {
      const id = (use.getAttribute('href') ?? '').slice(1)
      expect(root.querySelector(`symbol#${id}`)).not.toBeNull()
    }
  })
})

describe('dpp-verifier: lone snapshot input', () => {
  const SNAPSHOT_URL = `${ORIGIN}/${HANDLE}/dpp/${CODE}/v/1.json`

  it('verifies a pasted snapshot URL on its own proofs', async () => {
    stubFetch()
    const widget = await mountWidget(undefined, SNAPSHOT_URL)
    const card = widget.shadowRoot?.querySelector('.verifier-card')
    expect(card?.className).toContain('verdict-authentic')
  })

  it('marks the card single-snapshot, identity unconfirmed', async () => {
    // No manifest means no platform attestation and no
    // did:web binding to earn a named verdict from.
    stubFetch()
    const widget = await mountWidget(undefined, SNAPSHOT_URL)
    expect(widget.shadowRoot?.querySelector('.verifier-note')).not.toBeNull()
    expect(widget.shadowRoot?.querySelector('.verifier-card')?.className).
      toContain('identity-unconfirmed')
  })

  it('renders the nothing-to-verify notice for non-DPP JSON', async () => {
    vi.stubGlobal('fetch', async () => json({ hello: 1 }))
    const widget = await mountWidget(undefined, `${ORIGIN}/whatever.json`)
    expect(widget.shadowRoot?.querySelector('.verifier-unverifiable')).
      not.toBeNull()
    expect(widget.shadowRoot?.querySelector('.verifier-error')).toBeNull()
  })

  it('renders the notice for a page with no signed reference', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response('<html><body>plain page</body></html>', { status: 200 }))
    const widget = await mountWidget(undefined, `${ORIGIN}/page`)
    const notice = widget.shadowRoot?.querySelector('.verifier-unverifiable')
    expect(notice?.textContent).toContain('no signed data')
  })

  it('routes an unsupported proof format to the notice', async () => {
    // Signed, but in a suite this build does not ship: the
    // notice names the format instead of a red card reading
    // "Only 0 of 0 entries verified".
    const alien = {
      version: 1,
      publishedAt: '2026-05-01T12:00:00Z',
      proof: [{
        type: 'DataIntegrityProof',
        cryptosuite: 'made-up-2026',
        proofValue: 'z1'
      }]
    }
    vi.stubGlobal('fetch', async () => json(alien))
    const widget = await mountWidget(undefined, `${ORIGIN}/alien.json`)
    const notice = widget.shadowRoot?.querySelector('.verifier-unverifiable')
    expect(notice?.textContent).toContain('made-up-2026')
    expect(widget.shadowRoot?.querySelector('.verifier-card')).toBeNull()
  })

  it('routes a manifest with an unsigned snapshot to the notice', async () => {
    // The detector gates only the pasted artefact; a
    // snapshot fetched via a manifest can still carry no
    // proof, and used to render "Only 0 of 0 entries
    // verified" in red.
    vi.stubGlobal('fetch', async (input: string | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/manifest.json')) return json(manifest())
      if (url.endsWith('/v/1.json')) {
        return json({ version: 1, publishedAt: '2026-05-01T12:00:00Z' })
      }
      return new Response('not found', { status: 404 })
    })
    const widget = await mountWidget()
    const notice = widget.shadowRoot?.querySelector('.verifier-unverifiable')
    expect(notice?.textContent).toContain('no proof')
    expect(widget.shadowRoot?.textContent).not.toContain('0 of 0')
  })
})
