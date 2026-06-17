/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Locale resolution + reactive UI-label binding.
 *
 * The renderer does not derive its locale from the
 * URL. We pick on each load:
 *
 *   1. localStorage value (the user's last manual pick)
 *   2. first match of navigator.languages against the
 *      DPP's available locales (browser preference)
 *   3. first available locale (fallback)
 *
 * Components read the active locale and label bundle
 * via the `i18n` getter object: any reactive effect that
 * touches `i18n.locale` or `i18n.labels` auto-subscribes
 * to the underlying signals, so a locale change
 * re-renders every consumer.
 */
import { signal, effect } from '@/reactive/signals'
import { englishLabels, loadLabels, type Labels } from './labels'
import * as host from '@/host'
import { availableLocales } from '@/state'

const STORAGE_KEY = 'tm.locale'

// Native names cover the EU24 plus common non-EU
// locales. The picker uses these so the menu renders
// "Deutsch" while the active locale is still `en`.
export const NATIVE_NAMES: Record<string, string> = {
  bg: 'Български',
  bn: 'বাংলা',
  cs: 'Čeština',
  da: 'Dansk',
  de: 'Deutsch',
  el: 'Ελληνικά',
  en: 'English',
  es: 'Español',
  et: 'Eesti',
  fi: 'Suomi',
  fr: 'Français',
  ga: 'Gaeilge',
  hi: 'हिन्दी',
  hr: 'Hrvatski',
  hu: 'Magyar',
  id: 'Bahasa Indonesia',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  lt: 'Lietuvių',
  lv: 'Latviešu',
  mt: 'Malti',
  nb: 'Norsk bokmål',
  nl: 'Nederlands',
  pl: 'Polski',
  pt: 'Português',
  ro: 'Română',
  ru: 'Русский',
  sk: 'Slovenčina',
  sl: 'Slovenščina',
  sv: 'Svenska',
  tr: 'Türkçe',
  uk: 'Українська',
  zh: '中文',
}

export function nativeName(code: string): string {
  return NATIVE_NAMES[code] ?? code.toUpperCase()
}

export function detectLocale(
  available: ReadonlyArray<string> | null | undefined,
): string {
  // Older / minimal manifests may omit availableLocales
  // entirely; the verifier must still render them, so fall
  // back to English rather than dereferencing undefined.
  if (!available || available.length === 0) return 'en'
  if (typeof window === 'undefined') return available[0]

  // 1. user's prior pick
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && available.includes(stored)) return stored
  } catch { /* localStorage unavailable */ }

  // 2. browser preference (first match against
  //    available; strips region, `de-AT` matches `de`).
  const candidates = navigator.languages?.length
    ? navigator.languages
    : [navigator.language ?? 'en']
  for (const tag of candidates) {
    const lang = tag.split('-')[0].toLowerCase()
    if (available.includes(lang)) return lang
  }

  // 3. fallback
  return available[0]
}

function persistLocale(code: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, code)
  } catch { /* localStorage unavailable */ }
}

// ---- Reactive bindings ----
//
// Locale starts at English (the synchronous fallback)
// because the active snapshot's available-locales list
// isn't fetched until the host module's manifest +
// current-snapshot fetches resolve. An effect below
// updates the locale once the snapshot lands; from that
// point on the picker drives changes.
export const locale = signal('en')
export const labelSet = signal<Labels>(englishLabels)

// Run once on first data load: pick the right locale
// from the now-available list and persist nothing yet
// (the user hasn't made an explicit choice). After this
// the picker drives changes.
let localeBootstrapped = false
effect(() => {
  if (localeBootstrapped) return

  // Wait for data. In manifest mode `availableLocales`
  // reads the manifest's list; in single-snapshot mode it
  // derives from the loaded snapshot, which is only safe to
  // read once the host reports ready.
  if (host.loadState() !== 'ready') return
  locale.set(detectLocale(availableLocales()))
  localeBootstrapped = true
})

// Getter object so any effect reading `i18n.locale` /
// `i18n.labels` auto-subscribes to the underlying signal.
// A plain object with mutated fields would silently miss
// the dependency and the page would never re-render on
// language switch.
export const i18n = {
  get locale(): string { return locale(); },
  get labels(): Labels { return labelSet(); },
}

// Load the label bundle whenever the active locale
// changes (English is synchronous; the rest are
// code-split JSON imports).
effect(() => {
  const code = locale()
  loadLabels(code).then((l) => {
    // Guard against a slow earlier load resolving after a
    // newer locale was picked: only apply the bundle if its
    // locale is still the active one, else a stale load would
    // clobber the labels the user actually switched to.
    if (locale.peek() === code) labelSet.set(l)
  })
})

export function pickLocale(code: string): void {
  locale.set(code)
  persistLocale(code)
}

// Locale-aware number rendering: 87.3 -> "87,3" in de-DE,
// 1234.5 -> "1,234.5" in en, "1.234,5" in de. Reads the
// active locale reactively, so a caller inside an effect
// re-renders on a language switch. Formatters are cached per
// locale because Intl.NumberFormat construction is not free.
const numberFormatters = new Map<string, Intl.NumberFormat>()
export function formatNumber(n: number): string {
  const loc = i18n.locale
  let fmt = numberFormatters.get(loc)
  if (!fmt) {
    fmt = new Intl.NumberFormat(loc)
    numberFormatters.set(loc, fmt)
  }
  return fmt.format(n)
}

// Locale-canonical numeric date with a 4-digit year and
// zero-padded day/month, de-DE: 12.09.2025, en-US:
// 09/12/2025, ja: 2025/09/12. `dateStyle: 'short'` would
// normally do this but doesn't guarantee a 4-digit year on
// every locale; spelling each part out keeps it consistent.
// Shared by the event modal and the timeline cards; takes
// the locale explicitly because the callers read it inside
// their own effects.
const shortDateFormatters = new Map<string, Intl.DateTimeFormat>()
export function formatShortDate(iso: string, locale: string): string {
  let fmt = shortDateFormatters.get(locale)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, {
      day: '2-digit', month: '2-digit', year: 'numeric',
    })
    shortDateFormatters.set(locale, fmt)
  }
  return fmt.format(new Date(iso))
}
