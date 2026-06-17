/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Scheme guard for hyperlinks built from untrusted data
 * (library reference URLs, proof verificationMethod URLs).
 * A raw attacker-supplied value assigned straight to an
 * anchor's `href` can carry a `javascript:` / `data:` /
 * `vbscript:` payload that executes on click; `target` and
 * `rel` do not neutralise those schemes. Callers route the
 * value through here and only set `href` when it is
 * non-null, leaving an unsafe value as inert text.
 */

// Navigable web links plus `did:` (a verificationMethod can
// be a did:web identifier; it is inert when clicked but not
// dangerous). Everything else - notably javascript:/data: -
// is rejected.
const SAFE_SCHEMES = new Set(['http:', 'https:', 'did:'])

export function safeLinkHref(raw: string): string | null {
  let protocol: string
  try {
    // An absolute URL carries its own scheme. A relative or
    // protocol-relative value throws here (no base) and is
    // safe: it can only resolve to the page's own http(s)
    // origin, never a script scheme.
    protocol = new URL(raw).protocol
  } catch {
    return raw
  }

  // Return the raw value (not the parsed href) so a did:
  // identifier is not re-encoded; the parse above only
  // classifies the scheme.
  return SAFE_SCHEMES.has(protocol) ? raw : null
}
