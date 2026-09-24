/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How the boot reads the dynamic-data document the
 * manifest advertises at `dynamicDataUrl`: fetched beside
 * the snapshot and never waited on, revalidated because the
 * publisher rewrites it under one URL, and dropped without
 * a word to the visitor when it will not load. A reboot
 * onto another passport forgets it, and a document that
 * lands after the reboot stays out.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

type HostModule = typeof import('../src/host')

const DYNAMIC = {
  '@type': 'DppDynamicData',
  code: 'dpp-a',
  updatedAt: '2026-09-24T08:15:00Z',
  values: [{ propertyID: 'stateOfCharge', value: 81, unitCode: 'P1' }],
}

function manifestOf(extra: Record<string, unknown> = {}): unknown {
  return {
    '@type': 'DppManifest',
    code: 'dpp-a',
    currentVersion: 1,
    versions: [{ number: 1, url: 'v/1.json', hashValue: 'h1' }],
    epcisUrl: 'epcis.json',
    ...extra,
  }
}

const SNAPSHOT = { version: 1, publishedAt: '2026-01-01T00:00:00Z' }

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

interface Call { readonly url: string; readonly cache?: RequestCache }

// Route fetches by URL substring; a value is a payload or a
// promise of one the test resolves later. Unrouted URLs 404.
function stubFetch(routes: Record<string, unknown>): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (
    input: string | URL, init?: RequestInit,
  ): Promise<Response> => {
    const url = input.toString()
    calls.push({ url, cache: init?.cache })
    for (const [key, value] of Object.entries(routes)) {
      if (!url.includes(key)) continue
      return new Response(JSON.stringify(await value), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  })
  return calls
}

async function freshHost(): Promise<HostModule> {
  vi.resetModules()
  vi.stubGlobal('window', { location: { href: 'https://page.test/' } })
  return import('../src/host')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('bootFrom and the dynamic-data document', () => {
  it('fetches the advertised document past the HTTP cache', async () => {
    const host = await freshHost()
    const calls = stubFetch({
      '/a/manifest.json': manifestOf({ dynamicDataUrl: 'dynamic-data.json' }),
      '/a/v/1.json': SNAPSHOT,
      '/a/dynamic-data.json': DYNAMIC,
    })

    await host.bootFrom('https://cdn.test/a/manifest.json')

    await vi.waitFor(() => {
      expect(host.dynamicData.peek()?.code).toBe('dpp-a')
    })
    const call = calls.find((c) => c.url.endsWith('/a/dynamic-data.json'))
    expect(call?.cache).toBe('no-cache')
  })

  it('is ready before the document lands', async () => {
    const host = await freshHost()
    const doc = deferred<unknown>()
    stubFetch({
      '/a/manifest.json': manifestOf({ dynamicDataUrl: 'dynamic-data.json' }),
      '/a/v/1.json': SNAPSHOT,
      '/a/dynamic-data.json': doc.promise,
    })

    await host.bootFrom('https://cdn.test/a/manifest.json')

    expect(host.loadState.peek()).toBe('ready')
    expect(host.dynamicData.peek()).toBeNull()
    doc.resolve(DYNAMIC)
    await vi.waitFor(() => {
      expect(host.dynamicData.peek()).not.toBeNull()
    })
  })

  it('asks for nothing when the manifest advertises none', async () => {
    const host = await freshHost()
    const calls = stubFetch({
      '/a/manifest.json': manifestOf(),
      '/a/v/1.json': SNAPSHOT,
    })

    await host.bootFrom('https://cdn.test/a/manifest.json')

    expect(calls.some((c) => c.url.includes('dynamic'))).toBe(false)
    expect(host.dynamicData.peek()).toBeNull()
  })

  it('renders the passport when the document will not load', async () => {
    const host = await freshHost()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubFetch({
      '/a/manifest.json': manifestOf({ dynamicDataUrl: 'dynamic-data.json' }),
      '/a/v/1.json': SNAPSHOT,
    })

    await host.bootFrom('https://cdn.test/a/manifest.json')

    expect(host.loadState.peek()).toBe('ready')
    await vi.waitFor(() => { expect(warn).toHaveBeenCalled() })
    expect(host.dynamicData.peek()).toBeNull()
    warn.mockRestore()
  })

  it('keeps a late document out of the next passport', async () => {
    const host = await freshHost()
    const doc = deferred<unknown>()
    stubFetch({
      '/a/manifest.json': manifestOf({ dynamicDataUrl: 'dynamic-data.json' }),
      '/a/v/1.json': SNAPSHOT,
      '/a/dynamic-data.json': doc.promise,
      '/b/manifest.json': manifestOf(),
      '/b/v/1.json': SNAPSHOT,
    })

    await host.bootFrom('https://cdn.test/a/manifest.json')
    await host.bootFrom('https://cdn.test/b/manifest.json')
    doc.resolve(DYNAMIC)
    await new Promise((r) => { setTimeout(r, 0) })

    expect(host.dynamicData.peek()).toBeNull()
  })
})

describe('adaptDynamicRows', () => {
  it('labels a row by its name and shows its unit', async () => {
    const host = await freshHost()
    const [row] = host.adaptDynamicRows([{
      propertyID: 'stateOfCharge',
      name: [{ '@language': 'en', '@value': 'State of charge' }],
      value: 81,
      unitCode: 'P1',
    } as never])

    expect(row.name).toEqual({ en: 'State of charge' })
    expect(row.value).toMatchObject({ type: 'scalar', numeric: 81, unit: '%' })
    expect(row.namespace).toBe('stateOfCharge')
  })

  // The publisher does not name its dynamic rows yet, and
  // the frozen snapshot drops their property types, so the
  // term is all there is to show.
  it('falls back to the term when the row carries no name', async () => {
    const host = await freshHost()
    const [row] = host.adaptDynamicRows([
      { propertyID: 'fullCycles', value: 212 },
    ])

    expect(row.name).toBe('fullCycles')
  })
})
