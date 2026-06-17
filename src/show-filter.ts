/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * URL-driven namespace gate for category-2 (on-demand)
 * property rows. The publisher tags each on-demand row
 * with a `namespace` like `transpareo:capacityWh`; the
 * visitor unlocks one or more by appending
 * `?show=<token>[,<token>...]` to the URL. Pure
 * client-side: the bytes were already in the snapshot,
 * we just decide which ones to paint.
 *
 * Match semantics per row vs URL token:
 *   - token without ':' -> prefix match.
 *       row.namespace === token OR
 *       row.namespace.startsWith(token + ':')
 *   - token with ':'    -> exact match.
 *       row.namespace === token
 *
 * The token list is set-union: a row matched by any
 * token in the list shows once. `?show=` also accepts
 * the bracketed form `?show[]=...&?show[]=...` (which
 * the backend's Vendor API parser already understands)
 * so a hand-typed URL works either way.
 *
 * The signal updates on:
 *   - first read (module load picks up the initial
 *     query string),
 *   - browser back/forward (popstate),
 *   - same-tab URL rewrites via history.pushState /
 *     history.replaceState. Those don't fire popstate
 *     natively, so the SPA must call refreshShowTokens()
 *     after any pushState/replaceState that touches the
 *     querystring.
 */

import { signal } from '@/reactive/signals'

export const showTokens = signal<ReadonlyArray<string>>(parseFromLocation())

function parseFromLocation(): ReadonlyArray<string> {
  if (typeof window === 'undefined') return []
  return parseShowParam(window.location.search)
}

// Exported for unit tests and for any caller that needs
// to parse a raw search string (e.g. SSR pre-hydration).
// Accepts the comma form (`?show=a,b`), the bracketed
// form (`?show[]=a&show[]=b`), and any mix; returns the
// deduplicated, order-preserved token list.
export function parseShowParam(search: string): ReadonlyArray<string> {
  if (!search) return []
  const params = new URLSearchParams(search)
  const out: string[] = []
  const seen = new Set<string>()
  const add = (raw: string): void => {
    for (const part of raw.split(',')) {
      const tok = part.trim()
      if (!tok || seen.has(tok)) continue
      seen.add(tok)
      out.push(tok)
    }
  }
  for (const key of ['show', 'show[]']) {
    for (const v of params.getAll(key)) add(v)
  }
  return out
}

// True when a row with the given `namespace` is unlocked
// by ANY token in `tokens`. Rows without a namespace
// stay hidden when on-demand (a publisher that ships a
// param-limited row without a namespace is a freezer
// bug; we don't paper over it client-side).
export function isUnlocked(
  namespace: string | undefined,
  tokens: ReadonlyArray<string>,
): boolean {
  if (!namespace) return false
  for (const tok of tokens) {
    if (tok.includes(':')) {
      if (namespace === tok) return true
    } else {
      if (namespace === tok) return true
      if (namespace.startsWith(tok + ':')) return true
    }
  }
  return false
}

// Re-read window.location.search and update the signal.
// Components don't call this; bootstrap does, plus
// callers that mutate the URL via pushState (which
// doesn't fire popstate).
export function refreshShowTokens(): void {
  if (typeof window === 'undefined') return
  showTokens.set(parseFromLocation())
}

let bootstrapped = false

export function bootstrapShowTokens(): void {
  if (bootstrapped) return
  bootstrapped = true
  if (typeof window === 'undefined') return

  // Initial value was set at module load; this hooks
  // back/forward navigation. Programmatic pushState calls
  // fire no event the platform dispatches, so a host page
  // that rewrites `?show=` in place must call
  // refreshShowTokens() itself (exported above for exactly
  // that). The SPA's own pushState use (the event-id hash
  // sync) never touches the query string.
  window.addEventListener('popstate', refreshShowTokens)
}
