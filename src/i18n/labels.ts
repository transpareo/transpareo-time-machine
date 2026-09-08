/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * UI labels, one JSON per locale in `data/`. English is
 * bundled into the main chunk, since it is the synchronous
 * fallback every other locale leans on; the rest are
 * code-split so a visitor only pays for the active locale.
 *
 * The product / event content lives in the snapshot
 * JSON-LD (see `@/types`, `LocalizedText`); this module
 * covers SPA-version-locked UI strings only.
 */

import enLabels from './data/en.json'

export type Labels = typeof enLabels
export type LabelKey = keyof Labels
export const englishLabels: Labels = enLabels

// All bundled label files, registered at build time.
// `import.meta.glob` lets Vite split each .json into
// its own chunk so the visitor only fetches the locale
// they're using. English is left out: it is already in
// the main chunk through the static import above.
const loaders = import.meta.glob<{ default: Labels }>(
  ['./data/*.json', '!./data/en.json'],
)

// Locale codes we ship a bundle for: English, then the
// globbed filenames (`./data/de.json` -> `de`). The verifier
// resolves a host-page locale against this set.
export const bundledLocales: ReadonlyArray<string> = [
  'en',
  ...Object.keys(loaders).map((p) => p.replace(/^.*\/|\.json$/g, '')),
]

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
