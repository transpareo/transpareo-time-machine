/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What a `libraryRef` is allowed to be.
 *
 * The renderer resolves the ref against the manifest URL
 * and fetches whatever comes back, so the ref's shape is
 * the publisher's choice, not this codebase's. A hosted
 * issuer may emit an absolute URL on its own asset host; a
 * static bucket may emit a path beside the manifest; either
 * may pin a version or point at a mutable current entry.
 * All of those are the same one line of resolution here.
 *
 * These cases exist because that breadth was implicit
 * before: the fixtures demonstrate exactly one of the
 * shapes, which reads as though it were the shape. A
 * publisher reading the fixtures alone would not learn that
 * the other forms work, and a refactor narrowing the
 * resolution would break them with nothing to catch it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveLibraryUrl } from '@/library-lookup'
import { getManifestUrl } from '@/host'

vi.mock('@/host', () => ({ getManifestUrl: vi.fn() }))

const MANIFEST =
  'https://passports.example/acme/dpp/demo-2026-t001/manifest.json'

beforeEach(() => {
  vi.mocked(getManifestUrl).mockReturnValue(MANIFEST)
})

describe('resolveLibraryUrl: shapes a publisher may emit', () => {
  // A hosted issuer builds the ref through its asset-host
  // helper, so what lands in the snapshot is already
  // fetchable and the manifest URL contributes nothing.
  it('passes an absolute URL through, host and all', () => {
    const ref = 'https://cdn.example/acme/components/shell.jsonld'
    expect(resolveLibraryUrl(ref)).toBe(ref)
  })

  it('keeps an absolute URL on a different origin', () => {
    const ref = 'https://other-cdn.example/x/components/shell.jsonld'
    expect(resolveLibraryUrl(ref)).toBe(ref)
  })

  it('resolves a root-relative ref against the manifest origin', () => {
    expect(resolveLibraryUrl('/acme/components/shell.jsonld'))
      .toBe('https://passports.example/acme/components/shell.jsonld')
  })

  // The shape the fixtures in this repo use: a path beside
  // the manifest, pinned to a version.
  it('resolves a relative ref against the manifest directory', () => {
    expect(resolveLibraryUrl('component/elastane/v1.json')).toBe(
      'https://passports.example/acme/dpp/demo-2026-t001/'
      + 'component/elastane/v1.json',
    )
  })

  // Same resolution, no version in the path: a pointer that
  // is rewritten whenever the component is edited.
  it('resolves a relative pointer with no version in it', () => {
    expect(resolveLibraryUrl('components/elastane.jsonld')).toBe(
      'https://passports.example/acme/dpp/demo-2026-t001/'
      + 'components/elastane.jsonld',
    )
  })
})

describe('resolveLibraryUrl: nothing to resolve', () => {
  it('returns null without a ref', () => {
    expect(resolveLibraryUrl(undefined)).toBeNull()
    expect(resolveLibraryUrl('')).toBeNull()
  })

  it('returns null before the manifest URL is known', () => {
    vi.mocked(getManifestUrl).mockReturnValue(null)
    expect(resolveLibraryUrl('component/elastane/v1.json')).toBeNull()
  })

  // A ref rides in signed bytes but is still a string
  // someone typed. A malformed one yields null and the row
  // renders without a drill-down, rather than throwing
  // through the click handler.
  it('returns null for a ref no URL parser accepts', () => {
    vi.mocked(getManifestUrl).mockReturnValue('not a url')
    expect(resolveLibraryUrl('component/elastane/v1.json')).toBeNull()
  })
})
