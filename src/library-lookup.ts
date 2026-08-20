/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Per-composition-entry library lookup. Resolves the
 * snapshot's `libraryRef` (a relative or absolute URL)
 * against the manifest URL, fetches the JSON payload,
 * caches the result for the session, and returns the
 * `ComponentLookup` the modal renders below the snapshot-
 * frozen lead.
 *
 * The library object is NOT part of the signed payload and
 * nothing here establishes that it is the object the issuer
 * signed against. The ref carries no hash, and it may name
 * a version, a mutable pointer, or an absolute URL on a
 * host chosen by the publisher rather than by the reader.
 * That is deliberate rather than an oversight: an issuer can
 * correct a typo on a component file without re-signing
 * every DPP that references it, and the cost of that
 * freedom is that the bytes are undatable from here.
 *
 * Two consequences worth keeping in view. The claims a
 * composition makes are signed on the snapshot row itself
 * (name, country, rating, value, unit); what this fetch
 * adds is the editorial detail rendered beneath them. And
 * because a ref may be absolute and off-origin, opening a
 * passport can issue a request to a host the reader never
 * chose, so the fetch omits credentials and every value
 * reaches the DOM as text.
 */

import type { ComponentLookup, ComponentProperty } from '@/types'
import { canonicalRating } from '@/types'
import { getManifestUrl } from '@/host'
import { readJsonResponse } from '@/fetch-json'

const cache = new Map<string, Promise<ComponentLookup | null>>()

// Resolve a snapshot-carried `libraryRef` to a fully
// qualified URL using the manifest URL as the base. Same
// shape as the rest of the renderer (epcisUrl,
// versions[n].url). Returns null when the
// manifest URL is not yet known or the input is
// malformed; callers should gate clickability on the
// presence of `libraryRef`, not on this returning a
// URL, so we never reach this branch from a real click.
export function resolveLibraryUrl(
  ref: string | undefined,
): string | null {
  if (!ref) return null
  const base = getManifestUrl()
  if (!base) return null
  try {
    return new URL(ref, base).toString()
  } catch {
    return null
  }
}

export function lookupLibrary(
  ref: string,
): Promise<ComponentLookup | null> {
  const url = resolveLibraryUrl(ref)
  if (!url) return Promise.resolve(null)
  const hit = cache.get(url)
  if (hit) return hit
  const pending = fetchLookup(url)
  cache.set(url, pending)
  return pending
}

async function fetchLookup(
  url: string,
): Promise<ComponentLookup | null> {
  try {
    const res = await fetch(url, { credentials: 'omit' })
    if (!res.ok) return null
    const raw = await readJsonResponse<ComponentLookup>(res)
    return normalizeLookup(raw)
  } catch {
    return null
  }
}

// Library JSON shares the snapshot's rating convention,
// so the canonicalRating mapping applies here too. The
// rating field on a library property lives inside list-
// typed values' items (a 'list'-valued property is the
// only shape that carries per-item ratings); other value
// kinds carry no rating. We walk only that branch so the
// happy path stays cheap.
function normalizeLookup(lookup: ComponentLookup): ComponentLookup {
  if (!lookup.properties || lookup.properties.length === 0) return lookup
  let changed = false
  const next: ComponentProperty[] = lookup.properties.map((p) => {
    if (p.value.type !== 'list') return p
    let itemsChanged = false
    const items = p.value.items.map((it) => {
      const canon = canonicalRating(it.rating)
      if (canon === it.rating) return it
      itemsChanged = true
      return { ...it, rating: canon }
    })
    if (!itemsChanged) return p
    changed = true
    return { ...p, value: { ...p.value, items } }
  })
  return changed ? { ...lookup, properties: next } : lookup
}
