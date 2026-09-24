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
import type { PropertyValue } from '../src/types'

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
    expect(host.dynamicDataPending.peek()).toBe(true)
    doc.resolve(DYNAMIC)
    await vi.waitFor(() => {
      expect(host.dynamicData.peek()).not.toBeNull()
    })
    expect(host.dynamicDataPending.peek()).toBe(false)
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
    expect(host.dynamicDataPending.peek()).toBe(false)
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
    expect(host.dynamicDataPending.peek()).toBe(false)
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

describe('composeLiveRows', () => {
  // The marked rows of the current snapshot, as the adapter
  // builds them: each carries its reading at publish.
  async function frozen(): Promise<ReadonlyArray<PropertyValue>> {
    const host = await freshHost()
    const rows = [
      { propertyID: 'bpass:stateOfCharge', name: { en: 'State of charge' },
        value: 100, unitCode: 'P1', dynamic: true },
      { propertyID: 'bpass:capacityFade', name: { en: 'Capacity fade' },
        value: 0, unitCode: 'P1', dynamic: true },
      { propertyID: 'model', name: { en: 'Model' }, value: 'X' },
    ]
    const snapshot = { version: 1, publishedAt: '2026-01-01T00:00:00Z',
      product: { properties: rows } }
    return host.toRenderModel(snapshot as never).properties
  }

  it('shows the live reading under the snapshot label', async () => {
    const host = await freshHost()
    const [row] = host.composeLiveRows(await frozen(), [
      { propertyID: 'bpass:stateOfCharge', value: 81, unitCode: 'P1' },
    ])

    expect(row.name).toEqual({ en: 'State of charge' })
    expect(row.live).toBe(true)
    expect(row.value).toMatchObject({ type: 'scalar', numeric: 81, unit: '%' })
  })

  it('falls back to the reading at publish', async () => {
    const host = await freshHost()
    const rows = host.composeLiveRows(await frozen(), [
      { propertyID: 'bpass:stateOfCharge', value: 81 },
    ])

    expect(rows.map((r) => [r.key, r.value.numeric, r.live])).toEqual([
      ['bpass:stateOfCharge', 81, true],
      ['bpass:capacityFade', 0, false],
    ])
  })

  // No verified document: every marked row shows its
  // reading at publish.
  it('shows every reading at publish without a document', async () => {
    const host = await freshHost()
    const rows = host.composeLiveRows(await frozen(), null)

    expect(rows.map((r) => [r.value.numeric, r.live])).toEqual([
      [100, false], [0, false],
    ])
  })

  // A version whose snapshot marks no row for a reading.
  it('labels a reading the snapshot does not mark by its term', async () => {
    const host = await freshHost()
    const rows = host.composeLiveRows(await frozen(), [
      { propertyID: 'bpass:fullCycles', value: 212 },
    ])

    expect(rows.map((r) => r.name)).toEqual([
      { en: 'State of charge' }, { en: 'Capacity fade' }, 'bpass:fullCycles',
    ])
  })

  // The publisher may list a term it holds no reading for.
  it('reads a row without a value as no reading', async () => {
    const host = await freshHost()
    const rows = host.composeLiveRows(await frozen(), [
      { propertyID: 'bpass:stateOfCharge' },
    ])

    expect(rows[0]).toMatchObject({ live: false })
  })
})
