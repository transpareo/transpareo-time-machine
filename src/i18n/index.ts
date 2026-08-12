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
 *   1. the user's last manual pick, when they made it while
 *      this same host `lang` was in effect
 *   2. the host page's `lang` attribute, when it names an
 *      available locale (set via setHostLocale)
 *   3. that manual pick, made in some other context
 *   4. first match of navigator.languages against the
 *      DPP's available locales (browser preference)
 *   5. first available locale (fallback)
 *
 * Components read the active locale and label bundle
 * via the `i18n` getter object: any reactive effect that
 * touches `i18n.locale` or `i18n.labels` auto-subscribes
 * to the underlying signals, so a locale change
 * re-renders every consumer.
 */
import { signal, effect } from '@/reactive/signals'
import {
  englishLabels, loadLabels, bundledLocales, type Labels,
} from './labels'
import * as host from '@/host'
import { availableLocales } from '@/state'

const STORAGE_KEY = 'tm.locale'

// The host `lang` that was in effect when the stored pick was
// made, so the next load can tell "the visitor overrode this
// page" from "the visitor once picked something elsewhere".
// Absent when they picked on a page that set no `lang`.
const STORAGE_HOST_KEY = 'tm.locale.host'

// Native names for every locale we ship a label bundle
// for, in the locale's own script. The picker uses these
// so the menu renders "Deutsch" while the active locale
// is still `en`; nativeName falls back to the uppercased
// code for anything missing.
export const NATIVE_NAMES: Record<string, string> = {
  bg: 'Български',
  bn: 'বাংলা',
  bs: 'Bosanski',
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
  is: 'Íslenska',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  lt: 'Lietuvių',
  lv: 'Latviešu',
  mk: 'Македонски',
  mt: 'Malti',
  nb: 'Norsk bokmål',
  nl: 'Nederlands',
  pl: 'Polski',
  pt: 'Português',
  ro: 'Română',
  ru: 'Русский',
  sk: 'Slovenčina',
  sl: 'Slovenščina',
  sq: 'Shqip',
  sr: 'Српски',
  sv: 'Svenska',
  tr: 'Türkçe',
  uk: 'Українська',
  vi: 'Tiếng Việt',
  zh: '中文',
}

// The name we ship for a locale, or null when we ship none.
// Own properties only: locale codes ride in untrusted
// manifest data, and a code like "toString" would otherwise
// resolve to a function off Object's prototype, which every
// caller here treats as a string.
export function nativeNameOrNull(code: string): string | null {
  return Object.hasOwn(NATIVE_NAMES, code) ? NATIVE_NAMES[code] : null
}

export function nativeName(code: string): string {
  return nativeNameOrNull(code) ?? code.toUpperCase()
}

// What the viewer's locale calls a language ("German" for
// `de` while browsing in English); the picker leads every
// row with it and keeps the native name as the hint.
// Backed by Intl.DisplayNames, cached per viewer locale
// since the picker calls this once per option row on
// every menu render. Returns null when it would add
// nothing over the native name: the platform can't
// resolve either tag (both ride in untrusted manifest
// data and an invalid one throws RangeError, hence the
// try/catch pair), or the answer merely repeats the
// native name (compared case-insensitively, since the two
// sources disagree about case).
const displayNames = new Map<string, Intl.DisplayNames | null>()

export function localizedName(
  code: string, viewerLocale: string,
): string | null {
  let dn = displayNames.get(viewerLocale)
  if (dn === undefined) {
    try {
      dn = new Intl.DisplayNames([viewerLocale], { type: 'language' })
    } catch { dn = null }
    displayNames.set(viewerLocale, dn)
  }
  if (!dn) return null

  let name: string | undefined
  try { name = dn.of(code) } catch { name = undefined }
  if (!name || name === code) return null
  const isEcho = name.toLowerCase() === nativeName(code).toLowerCase()
  return isEcho ? null : menuCase(name, viewerLocale)
}

// Intl.DisplayNames answers in the form a sentence would
// use, and more than half the locales we ship write language
// names lowercase there: Italian "parlo rumeno", French
// "allemand", Russian "болгарский". A picker row is not a
// sentence, and CLDR carries a separate rule for exactly this
// (contextTransforms, titlecase-firstword for uiListOrMenu
// and stand-alone) that the Intl API has no parameter for, so
// the caller applies it. Without this the row reads "rumeno"
// beside its own native name "Română".
//
// First code point only: "inglese britannico" becomes
// "Inglese britannico", never "Inglese Britannico". Locale-
// aware so a Turkish viewer would get the dotted capital;
// today no shipped locale hands us a lowercase Turkish
// initial, but the casing rule belongs with the locale, not
// with our assumptions about CLDR's current data. A caseless
// script is untouched: Chinese 罗马尼亚语, Japanese
// ルーマニア語 and Hindi रोमानियाई come back unchanged.
function menuCase(name: string, viewerLocale: string): string {
  const [first] = name
  return first.toLocaleUpperCase(viewerLocale) + name.slice(first.length)
}

// Every locale we ship a UI label bundle for, English first
// so it is the fallback. The verifier resolves its own locale
// against this (it has no DPP `availableLocales` to draw on,
// unlike the renderer).
export const UI_LOCALES: ReadonlyArray<string> = [
  'en',
  ...bundledLocales.filter((c) => c !== 'en'),
]

// Locale the embedding page hands us via the element's `lang`
// attribute (e.g. `<dpp-verifier lang="de">`). A page that
// pins `lang` is telling us to match its own chrome, and its
// language picker reloads the page with a new `lang`, so this
// outranks a pick the visitor made somewhere else. It does
// not outrank one they made right here, on a page carrying
// this same `lang` - see detectLocale. null on a page that
// sets no `lang`, which either element may be.
//
// Module-global, like the `locale` signal it feeds: one
// active locale per page. Two widgets with different `lang`s
// would share it, last to mount wins. Pages embed a single
// widget, so this stays a documented assumption, not a bug.
let hostLocale: string | null = null

export function setHostLocale(
  code: string | null | undefined,
): void {
  const norm = code?.split('-')[0].toLowerCase()
  hostLocale = norm || null
}

export function detectLocale(
  available: ReadonlyArray<string> | null | undefined,
): string {
  // Older / minimal manifests may omit availableLocales
  // entirely; the verifier must still render them, so fall
  // back to English rather than dereferencing undefined.
  if (!available || available.length === 0) return 'en'

  const wantsHost = hostLocale && available.includes(hostLocale)
  if (typeof window === 'undefined') {
    return wantsHost ? hostLocale! : available[0]
  }

  // 1. a pick the visitor made on a page carrying this same
  //    `lang`: they overrode this page's chrome deliberately,
  //    and the in-page picker has to keep its promise.
  const stored = readStoredPick(available)
  if (stored?.madeHere) return stored.code

  // 2. host page locale (the `lang` attribute), the one
  //    instruction that comes from outside the widget.
  if (wantsHost) return hostLocale!

  // 3. that pick, made in some other context. Decides on
  //    every page that sets no `lang`, so switching the
  //    language there is still remembered.
  if (stored) return stored.code

  // 4. browser preference (first match against
  //    available; strips region, `de-AT` matches `de`).
  const candidates = navigator.languages?.length
    ? navigator.languages
    : [navigator.language ?? 'en']
  for (const tag of candidates) {
    const lang = tag.split('-')[0].toLowerCase()
    if (available.includes(lang)) return lang
  }

  // 5. fallback
  return available[0]
}

interface StoredPick {
  readonly code: string

  // The pick was made while this same host `lang` was in
  // effect (both absent counts), so it speaks for this page
  // rather than for whichever one the visitor made it on.
  readonly madeHere: boolean
}

function readStoredPick(
  available: ReadonlyArray<string>,
): StoredPick | null {
  try {
    const code = window.localStorage.getItem(STORAGE_KEY)
    if (!code || !available.includes(code)) return null
    const host = window.localStorage.getItem(STORAGE_HOST_KEY)
    return { code, madeHere: host === hostLocale }
  } catch { /* localStorage unavailable */ }
  return null
}

function persistLocale(code: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, code)
    if (hostLocale) window.localStorage.setItem(STORAGE_HOST_KEY, hostLocale)
    else window.localStorage.removeItem(STORAGE_HOST_KEY)
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
