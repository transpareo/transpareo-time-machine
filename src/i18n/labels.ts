/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * UI labels, one JSON per locale in `data/`. Vite
 * code-splits each into its own chunk so a visitor only
 * pays for the active locale; English is the
 * synchronous fallback used while another locale loads.
 *
 * The product / event content lives in the snapshot
 * JSON-LD (see `@/types`, `LocalizedText`); this module
 * covers SPA-version-locked UI strings only.
 */

const enModule = await import('./data/en.json')
const enLabels = enModule.default

export type Labels = typeof enLabels
export type LabelKey = keyof Labels
export const englishLabels: Labels = enLabels

// All bundled label files, registered at build time.
// `import.meta.glob` lets Vite split each .json into
// its own chunk so the visitor only fetches the locale
// they're using.
const loaders = import.meta.glob<{ default: Labels }>(
  './data/*.json',
)

// Locale codes we ship a bundle for, derived from the
// globbed filenames (`./data/de.json` -> `de`). The verifier
// resolves a host-page locale against this set.
export const bundledLocales: ReadonlyArray<string> =
  Object.keys(loaders).map((p) => p.replace(/^.*\/|\.json$/g, ''))

const cache = new Map<string, Labels>([['en', enLabels]])

export async function loadLabels(locale: string): Promise<Labels> {
  const cached = cache.get(locale)
  if (cached) return cached
  const loader = loaders[`./data/${locale}.json`]
  if (!loader) return enLabels
  try {
    const mod = await loader()
    cache.set(locale, mod.default)
    return mod.default
  } catch {
    return enLabels
  }
}

// Synchronous lookup helper. Templates pull the active
// label set from `i18n.labels` and pass it in. Falls back
// to English then the key itself, so a missing translation
// never renders empty.
export function t(
  labels: Labels,
  key: LabelKey,
  vars?: Record<string, string | number>,
): string {
  const raw = labels[key] ?? englishLabels[key] ?? String(key)
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (_, name) => {
    const v = vars[name]
    return v == null ? `{${name}}` : String(v)
  })
}
