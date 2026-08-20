/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Intl.DisplayNames access, shared by the locale picker
 * (language names) and the country resolver (region names
 * on property values and the manufacturer address).
 *
 * Two guards ride on every lookup:
 *
 *   - Codes and locale tags both arrive in untrusted
 *     document data, and an invalid tag throws
 *     RangeError, hence the try/catch pair.
 *   - An engine carrying no data for a locale does not
 *     throw: it resolves to a fallback and answers in that
 *     instead, so a Maltese viewer would read English
 *     names with nothing downstream able to tell. The
 *     mismatch is rejected so the caller can fall back to
 *     something it controls.
 *
 * The module imports nothing from the app, so types.ts
 * can reach it from `tx()` without an import cycle
 * (i18n/index.ts -> host.ts -> types.ts).
 */

type NameType = 'language' | 'region'

// One instance per locale + type: the picker asks once
// per option row on every menu render, and a property
// grid once per country tile.
const instances = new Map<string, Intl.DisplayNames | null>()

// A DisplayNames that answers in `locale`, or null when
// the platform cannot serve that locale at all.
export function displayNamesFor(
  locale: string, type: NameType,
): Intl.DisplayNames | null {
  const key = `${type}:${locale}`
  let dn = instances.get(key)
  if (dn === undefined) {
    try {
      const made = new Intl.DisplayNames([locale], { type })
      dn = answersIn(made, locale) ? made : null
    } catch { dn = null }
    instances.set(key, dn)
  }
  return dn
}

// True when the platform answers in the language we asked
// for. Only the language subtag is compared: a request for
// `pt` answered as `pt-BR` is still Portuguese.
function answersIn(dn: Intl.DisplayNames, requested: string): boolean {
  const got = dn.resolvedOptions().locale.split('-')[0].toLowerCase()
  return got === requested.split('-')[0].toLowerCase()
}

// ISO 3166-1 reserves ZZ for "unknown", and CLDR names it
// ("Unknown Region", localized). A placeholder dressed as a
// country reads like a real answer, so it resolves like any
// other code the platform cannot name.
const UNKNOWN_REGION = 'ZZ'

// What `locale` calls the country behind an ISO 3166-1
// alpha-2 code: "Portugal" in en and de, "Portugalia" in
// ro. Null when the platform cannot resolve it, or when it
// echoes the code back, so the caller falls back to the
// code itself - which is what the signed bytes carry and
// what a regulator reads.
export function regionName(code: string, locale: string): string | null {
  // Alpha-2 codes are upper case and Intl does not case-fold
  // them: `of('pt')` hands "pt" straight back. Normalizing
  // the lookup key means a lower-case code still names its
  // country. Only the key is normalized - a caller that
  // falls back prints the document's own lexical form, not
  // this one.
  const key = code.toUpperCase()
  if (key === UNKNOWN_REGION) return null
  const dn = displayNamesFor(locale, 'region')
  if (!dn) return null

  let name: string | undefined
  try { name = dn.of(key) } catch { name = undefined }
  if (!name || name === key) return null
  return name
}
