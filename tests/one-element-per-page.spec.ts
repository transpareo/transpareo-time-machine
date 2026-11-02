// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * One <transpareo-time-machine> per page. The renderer keeps
 * the passport it shows in module state, so the first element
 * to connect holds the page until it leaves it. Another one
 * stays empty, leaves the config alone and says why on the
 * console. Every boot starts from cleared verdicts: a `src`
 * change, a reconnect and an element that replaces a removed
 * one alike.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import '@/components/transpareo-time-machine'
import { config } from '@/config'
import { versionStates } from '@/state'
import * as host from '@/host'
import { labelSet, labelsReady, locale } from '@/i18n'
import { loadLabels } from '@/i18n/labels'
import { iconForProperty } from '@/icons'
import { revocationStatus } from '@/revoked-roots'
import { encodeMultibaseBase58 } from '@/crypto/multibase'
import type { DppManifest, SignedSnapshot } from '@/archive'

const A = 'https://cdn.test/a/manifest.json'
const A2 = 'https://cdn.test/a2/manifest.json'
const B = 'https://cdn.test/b/manifest.json'
const B2 = 'https://cdn.test/b2/manifest.json'
const LIST = 'https://cdn.test/revoked.json'
const MAP = 'https://cdn.test/icon-map.json'
const LOCALES = ['en', 'de', 'fr']

const SNAPSHOT = {
  version: 1, publishedAt: '2026-01-01T00:00:00Z', passportAlias: 'a'
} as unknown as SignedSnapshot

// An Ed25519 multikey (the 0xed01 prefix) over zero key bytes.
const PIN = encodeMultibaseBase58(
  Uint8Array.of(0xed, 0x01, ...new Uint8Array(32))
)

// Every URL the page asked for. A boot asks for its `src`
// at once, before its first await.
const calls: string[] = []

// What a URL answers; any other one answers 404.
const answers = new Map<string, () => Promise<Response>>()

function booted(src: string): boolean {
  return calls.includes(src)
}

function answer(body: unknown): Response {
  const json = (): Promise<unknown> => Promise.resolve(body)
  return { ok: true, status: 200, json } as unknown as Response
}

// Answers `url` with `body` once the spec says so.
function hold(url: string): (body: unknown) => void {
  let release: (res: Response) => void = () => {}
  const held = new Promise<Response>((resolve) => { release = resolve })
  answers.set(url, () => held)
  return (body) => release(answer(body))
}

// Lets every answer already given run to its end.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// The page shows a passport offering LOCALES: what the
// locale pick waits for.
function ready(): void {
  host.manifest.set({ availableLocales: LOCALES } as unknown as DppManifest)
  host.loadState.set('ready')
}

function mount(src: string, attrs: Record<string, string> = {}): Element {
  const el = document.createElement('transpareo-time-machine')
  el.setAttribute('src', src)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.appendChild(el)
  return el
}

// A verdict of the passport shown before, which a boot must
// not carry over.
function leaveVerdict(): void {
  versionStates.set({ 1: { status: 'pending' } })
}

beforeEach(() => {
  calls.length = 0
  answers.clear()
  vi.stubGlobal('fetch', (input: string | URL) => {
    const url = String(input)
    calls.push(url)
    const given = answers.get(url)
    if (given) return given()
    return Promise.resolve(new Response(null, { status: 404 }))
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a second element on the page', () => {
  it('stays empty while the first one boots', () => {
    mount(A)
    const second = mount(B)

    expect(booted(A)).toBe(true)
    expect(booted(B)).toBe(false)
    expect(second.shadowRoot?.querySelector('.tm-content')).toBeNull()
  })

  it('says why, once', () => {
    mount(A)
    mount(B)

    expect(console.error).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(console.error).mock.calls[0][0])).
      toMatch(/already shows a passport/)
  })

  it('leaves the config of the first one alone', () => {
    mount(A)
    mount(B, { 'asset-host': 'https://other.test' })

    expect(config.assetHost).toBeUndefined()
  })

  it('ignores a new src, which the first one boots', () => {
    const first = mount(A)
    const second = mount(B)

    second.setAttribute('src', B2)
    first.setAttribute('src', A2)

    expect(booted(B2)).toBe(false)
    expect(booted(A2)).toBe(true)
  })

  it('reports no passport state of its own', () => {
    const first = document.createElement('transpareo-time-machine')
    first.setAttribute('verifier', '')
    document.body.appendChild(first)
    const second = mount(B) as Element & { state: unknown }

    // The page reads as showing a passport: what the state
    // getter needs, without a tree mounted around it.
    host.manifest.set({ code: 'dpp-a', currentVersion: 1 } as DppManifest)
    host.currentVersion.set(1)
    host.snapshots.set({ 1: host.toRenderModel(SNAPSHOT) })
    host.loadState.set('ready')
    labelsReady.set(true)

    try {
      expect((first as Element & { state: unknown }).state).not.toBeNull()
      expect(second.state).toBeNull()
    } finally {
      host.loadState.set('idle')
      host.manifest.set(null)
      host.currentVersion.set(0)
      host.snapshots.set({})
      labelsReady.set(false)
    }
  })
})

describe('an element that boots', () => {
  it('drops the verdicts before on a new src', () => {
    const el = mount(A)
    leaveVerdict()

    el.setAttribute('src', A2)

    expect(booted(A2)).toBe(true)
    expect(versionStates.peek()).toEqual({})
  })

  it('drops them when it reconnects with a src set meanwhile', () => {
    const el = mount(A)
    el.remove()
    el.setAttribute('src', A2)
    leaveVerdict()

    document.body.appendChild(el)

    expect(booted(A2)).toBe(true)
    expect(versionStates.peek()).toEqual({})
  })

  it('takes over the page once the first one has left', () => {
    mount(A).remove()
    leaveVerdict()

    mount(B)

    expect(booted(B)).toBe(true)
    expect(versionStates.peek()).toEqual({})
    expect(console.error).not.toHaveBeenCalled()
  })
})

// The element before set the page up from its attributes; the
// one that replaces it reads only its own, and the defaults
// for those it omits.
describe('an element that replaces one', () => {
  it('reads only its own attributes', () => {
    answers.set(LIST, () => Promise.resolve(answer({ revokedRoots: [] })))
    mount(A, {
      'asset-host': 'https://cdn.test',
      'sign-in-url': 'https://shop.test/login',
      'pinned-platform-key': PIN,
      'revoked-roots-src': LIST
    }).remove()

    mount(B)

    expect(config.assetHost).toBeUndefined()
    expect(config.signInUrl).toBeUndefined()
    expect(config.pinnedPlatformKeys).toBeUndefined()
    expect(config.revokedRootsUrl).toBeUndefined()
  })

  it('holds its own pins against the revocation list', async () => {
    mount(A).remove()
    answers.set(LIST, () => Promise.resolve(answer({ revokedRoots: [] })))

    mount(B, { 'pinned-platform-key': PIN, 'revoked-roots-src': LIST })

    await vi.waitFor(() => expect(revocationStatus()).toBe('ok'))
    expect(booted(LIST)).toBe(true)
  })

  it('drops a revocation check the one before still runs', async () => {
    const release = hold(LIST)
    const attrs = { 'pinned-platform-key': PIN, 'revoked-roots-src': LIST }
    const first = mount(A, attrs)
    await vi.waitFor(() => expect(booted(LIST)).toBe(true))
    first.remove()

    mount(B)
    release({ revokedRoots: [] })
    await settle()

    expect(revocationStatus()).toBe('unpinned')
  })

  it('starts without the icon map of the one before', async () => {
    answers.set(MAP, () => Promise.resolve(answer({ material: 'leaf' })))
    const first = mount(A, { 'icon-map-src': MAP })
    await vi.waitFor(() => expect(iconForProperty('material')).toBe('leaf'))
    first.remove()

    mount(B)

    expect(iconForProperty('material')).toBeNull()
  })

  it('drops an icon map the one before still loads', async () => {
    const release = hold(MAP)
    mount(A, { 'icon-map-src': MAP }).remove()

    mount(B)
    release({ material: 'leaf' })
    await settle()

    expect(iconForProperty('material')).toBeNull()
  })

  // Each element leaves the page before its passport reads
  // as ready, so no card mounts around the fake manifest.
  it('picks the locale its own attribute names', () => {
    mount(A, { locale: 'de' }).remove()
    ready()

    mount(B, { locale: 'fr' }).remove()
    ready()

    expect(locale()).toBe('fr')
  })

  it('holds its first paint for its own labels', async () => {
    mount(A, { locale: 'de' }).remove()
    ready()
    mount(B, { locale: 'fr' }).remove()

    await loadLabels('de')
    await settle()
    expect(labelsReady()).toBe(false)

    ready()
    await vi.waitFor(() => expect(labelsReady()).toBe(true))
    expect(labelSet()['locale.noMatches']).toBe('Aucun résultat')
  })
})
