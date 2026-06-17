/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Passport-page-to-manifest resolution for the standalone
 * verifier widget. QR codes and shared links carry the
 * passport page URL, not the manifest URL the page renders
 * from; when a pasted URL serves HTML instead of JSON, the
 * widget looks up the page's manifest reference here, so a
 * visitor can verify straight from the link on the product
 * without ever learning that a manifest exists.
 *
 * Discovery order:
 *
 *   1. The `src` of an embedded <transpareo-time-machine>.
 *      A page rendered by this package names its manifest
 *      there, and that is exactly the document the page's
 *      visitors see.
 *   2. <link rel="alternate" type="application/json"> (or
 *      application/ld+json): the machine-readable
 *      declaration a server-rendered passport page can
 *      carry when it doesn't embed the renderer.
 *
 * The page markup is parsed with DOMParser, which neither
 * runs scripts nor loads subresources, so parsing an
 * arbitrary fetched page is inert. The discovered
 * reference resolves against the page URL and must come
 * out http(s); anything else is dropped rather than handed
 * to fetch.
 */

// The artefacts the verifier accepts (manifest, snapshot)
// are JSON objects, so their first byte is `{`; markup
// starts with `<`. The body, not the Content-Type header,
// decides: CDNs and app servers label JSON with assorted
// types, and a body opening with `<` can never be JSON.
// (trimStart also strips a BOM; U+FEFF is JS whitespace.)
export function looksLikeHtml(body: string): boolean {
  return body.trimStart().startsWith('<')
}

export function discoverManifestUrl(
  page: string, pageUrl: string,
): string | null {
  const doc = new DOMParser().parseFromString(page, 'text/html')
  const ref = embeddedRendererSrc(doc) ?? linkAlternateHref(doc)
  if (!ref) return null
  return toHttpUrl(ref, pageUrl)
}

function embeddedRendererSrc(doc: Document): string | null {
  return doc.querySelector('transpareo-time-machine[src]')
    ?.getAttribute('src') || null
}

const JSON_LINK_TYPES = new Set([
  'application/json', 'application/ld+json',
])

// Exact type match on purpose: `application/json+oembed`
// and friends are alternates too, but not the manifest.
function linkAlternateHref(doc: Document): string | null {
  for (const link of doc.querySelectorAll('link[href]')) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/)
    const type = (link.getAttribute('type') ?? '').toLowerCase()
    if (rel.includes('alternate') && JSON_LINK_TYPES.has(type)) {
      return link.getAttribute('href') || null
    }
  }
  return null
}

function toHttpUrl(ref: string, base: string): string | null {
  try {
    const url = new URL(ref, base)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString()
    }
  } catch {
    // unparseable reference: treated as not found below
  }
  return null
}
