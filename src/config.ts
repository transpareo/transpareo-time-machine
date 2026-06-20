/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Host config, read from the <transpareo-time-machine>
 * element's attributes.
 *
 * Every option is an attribute on the element
 * (icons-src, revoked-roots-src, show-verification-mark,
 * pinned-platform-key, pinned-issuer-key, verifier,
 * footer-copyright, footer-links).
 * initConfigFromElement reads them once in the element's
 * setup(), before its subtree mounts, so the consumers
 * below (read at render time) see populated values.
 * Anything the host omits stays undefined; the SPA hides
 * the affected UI rather than fabricating a default.
 *
 * The DPP data source is the element's `src` attribute
 * (a manifest URL or a single snapshot URL); it is handled
 * by the host data layer (host.ts), not part of this config.
 *
 * Locales are NOT in this config: the SPA derives
 * available locales from the DPP data itself
 * (snapshot `@language` arrays) and resolves the
 * current locale via i18n.ts. See lib/i18n.ts.
 */

export interface FooterLink {
  readonly label: string

  // `url` is the documented key; `href` is accepted as
  // an alias so either spelling works in an embed shell.
  readonly url?: string
  readonly href?: string

  // Stable identifier the backend tags links with
  // (e.g. 'imprint', 'privacy'). The renderer
  // doesn't use it today but ships it through so a
  // host page hook can theme by key.
  readonly key?: string
}

export interface TimeMachineConfig {
  readonly footer?: {
    readonly copyright?: string
    readonly links?: ReadonlyArray<FooterLink>
  }

  // URL for the decorative content sprite (the publisher's
  // icon vocabulary, addressed by name from snapshot data).
  // From the `icons-src` attribute. The renderer's
  // functional icons are bundled inline and need no sprite;
  // this supplies only the content icons. In dev it defaults
  // to the seeded '/icons.svg'; a production build has no
  // default, so a host points it at its own sprite (CDN,
  // admin path). Without it the decorative icon boxes
  // collapse.
  readonly iconsUrl?: string

  // URL for the property icon map: a JSON object keyed by a
  // property's `propertyID` (the vocabulary namespace, e.g.
  // `transpareo:carbon`) with content-sprite symbol ids as
  // values. From the `icon-map-src` attribute. Lets the
  // snapshot ship presentation-free rows: the SPA resolves
  // each row's decorative icon from its key through this
  // table instead of an inline icon field. No default: a
  // host points it at its own table, served beside the
  // sprite. Without it (and the sprite) rows render
  // iconless.
  readonly iconMapUrl?: string

  // From `show-verification-mark`. When `false`, the
  // brandbar's "Verified by ..." chip is suppressed. Default
  // (undefined or any other value): chip renders. Matches
  // the publisher-side `dpp_show_verification_mark` toggle.
  readonly showVerificationMark?: boolean

  // From the `verifier` attribute (presence). When set, the
  // <transpareo-time-machine> element skips its manifest
  // fetch and mounts <dpp-verifier> in its place so the
  // visitor can paste a manifest URL and run the proof check
  // manually. Set by the backend's verifier shell route.
  readonly verifier?: boolean

  // From `pinned-platform-key`: a whitespace-separated set
  // of platform Ed25519 Multikeys (publicKeyMultibase,
  // 'z' + Base58Btc of 0xED01 + 32 raw bytes) the SPA
  // trusts as the platform-side proof keys. A set rather
  // than one key because rotation keeps retired-but-sound
  // keys verifiable for historical snapshots; the host
  // shell lists every non-compromised version, current
  // first. Used for two purposes:
  //   1. Role-tag the platform proof entry so the
  //      chip's two-of-two verdict requires one of the
  //      pinned platform keys (not just two distinct
  //      verified signature groups).
  //   2. Compute the revoked-roots fingerprints
  //      (SHA-256 of the decoded multikey bytes)
  //      compared at boot against the published
  //      revocation list.
  // Absent: chip falls back to signature-grouping
  // only; revoked-roots check is skipped.
  readonly pinnedPlatformKeys?: ReadonlyArray<string>

  // From `pinned-issuer-key`, same whitespace-separated
  // Multikey format: the issuer's declared signing keys.
  // Under BYOK these are the customer's own registered
  // public keys, so the chip can require the issuer-side
  // proof to come from the declared keys rather than any
  // key the snapshot references. Absent: issuer side
  // falls back to signature-grouping.
  readonly pinnedIssuerKeys?: ReadonlyArray<string>

  // From `revoked-roots-src`. URL the SPA fetches at boot to
  // check whether its pinned key has been revoked. Defaults
  // to Transpareo's well-known endpoint; forks point at
  // their own. Set to an empty string to disable the check
  // entirely (useful for dev / offline).
  readonly revokedRootsUrl?: string
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

// Populated from the <transpareo-time-machine> element's
// attributes by initConfigFromElement (called in the
// element's setup() before its subtree mounts). Consumers
// import `config` and read it at render time, so the values
// are present by then.
const state: Mutable<TimeMachineConfig> = {}

export const config: TimeMachineConfig = state

// Read the host config off the element's attributes. URL
// options use the `-src` suffix; `verifier` is a presence
// flag; `show-verification-mark="false"` is the only value
// that suppresses the chip; the footer is `footer-copyright`
// (text) + `footer-links` (a JSON array). The DPP data
// source (`src`) is handled by host.ts, not here.
export function initConfigFromElement(el: Element): void {
  const str = (name: string): string | undefined => {
    const v = el.getAttribute(name)
    return v === null ? undefined : v
  }
  const next: Mutable<TimeMachineConfig> = {
    iconsUrl: str('icons-src'),
    iconMapUrl: str('icon-map-src'),
    revokedRootsUrl: str('revoked-roots-src'),
    pinnedPlatformKeys: parseKeySet(el, 'pinned-platform-key'),
    pinnedIssuerKeys: parseKeySet(el, 'pinned-issuer-key'),
    verifier: el.hasAttribute('verifier') || undefined,
    showVerificationMark: parseShowMark(el),
    footer: parseFooter(el),
  }
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined) (state as Record<string, unknown>)[k] = v
  }
}

// A pinned-key attribute carries one or more multikeys
// separated by whitespace. Blank or absent yields undefined
// (unpinned), never an empty array, so consumers can
// treat "pins configured" as a single truthy check.
// Exported for <dpp-verifier>, which reads its own
// pinned-platform-key attribute outside this config.
export function parseKeySet(
  el: Element, name: string,
): ReadonlyArray<string> | undefined {
  const raw = el.getAttribute(name)
  if (raw === null) return undefined
  const keys = raw.split(/\s+/).filter(Boolean)
  return keys.length > 0 ? keys : undefined
}

function parseShowMark(el: Element): boolean | undefined {
  const v = el.getAttribute('show-verification-mark')
  if (v === null) return undefined
  return v !== 'false'
}

function parseFooter(
  el: Element,
): TimeMachineConfig['footer'] | undefined {
  const copyright = el.getAttribute('footer-copyright') ?? undefined
  const links = parseFooterLinks(el)
  if (!copyright && !links) return undefined
  return {
    ...(copyright ? { copyright } : {}),
    ...(links ? { links } : {}),
  }
}

function parseFooterLinks(
  el: Element,
): ReadonlyArray<FooterLink> | undefined {
  const raw = el.getAttribute('footer-links')
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? (parsed as ReadonlyArray<FooterLink>)
      : undefined
  } catch {
    return undefined
  }
}

// True when the footer should render at all (any
// copyright text or any link).
export function hasFooter(): boolean {
  const f = config.footer
  if (!f) return false
  return Boolean(
    f.copyright || (f.links && f.links.length > 0),
  )
}
