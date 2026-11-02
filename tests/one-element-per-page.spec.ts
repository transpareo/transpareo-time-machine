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
import { labelsReady } from '@/i18n'
import type { DppManifest, SignedSnapshot } from '@/archive'

const A = 'https://cdn.test/a/manifest.json'
const A2 = 'https://cdn.test/a2/manifest.json'
const B = 'https://cdn.test/b/manifest.json'
const B2 = 'https://cdn.test/b2/manifest.json'

const SNAPSHOT = {
  version: 1, publishedAt: '2026-01-01T00:00:00Z', passportAlias: 'a'
} as unknown as SignedSnapshot

// Every URL the page asked for. A boot asks for its `src`
// at once, before its first await.
const calls: string[] = []

function booted(src: string): boolean {
  return calls.includes(src)
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
  vi.stubGlobal('fetch', (input: string | URL) => {
    calls.push(String(input))
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

  // initConfigFromElement merges and never clears.
  delete (config as { assetHost?: string }).assetHost
  delete (config as { verifier?: boolean }).verifier
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
