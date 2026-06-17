/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { Organization } from './archive'

// Translatable scalar. Either a single string (one
// locale, codes, proper nouns, etc.) or a record keyed
// by locale code (`{ en: '...', de: '...' }`).
//
// The two named aliases below share the same runtime
// shape but mark which contract surface a field lives
// on:
//
//   SnapshotLocalizedText - signed bytes from the
//     publisher's per-version snapshot. The backend's
//     serializer declares only a small set of fields
//     with `@container: @language` (name, description,
//     reason, category). Every snapshot-derived field
//     that may legitimately carry a per-locale hash
//     uses this alias.
//
//   SpaLocalizedText - SPA-internal data fetched
//     outside the signed snapshot (component-library
//     JSON, future Localization API surfaces, leadgen
//     overlays). Same runtime shape; separate name so
//     a static reader can tell at a glance which
//     contract surface they are looking at.
//
// LocalizedText is the runtime-helper-friendly
// supertype kept for `tx()` and the few generic
// utilities (isLocalizedText guard, donut name key)
// that don't care about contract surface.
//
// Under EN 18223 the wire carries every localized literal
// (product name / category / description, property names,
// substance names) in the JSON-LD expanded array form
// `[{ '@value', '@language' }, ...]`. `foldLocale` collapses
// it back to a locale hash at the wire->model boundary
// (host.ts adapter + the value classifier), so this model
// type and `tx()` only ever see `string | { locale: text }`.
export type SnapshotLocalizedText =
  | string
  | Readonly<Record<string, string>>
export type SpaLocalizedText =
  | string
  | Readonly<Record<string, string>>
export type LocalizedText = SnapshotLocalizedText | SpaLocalizedText

export function tx(
  text: LocalizedText | undefined | null,
  locale: string,
  fallback = 'en',
): string {
  if (text == null) return ''
  if (typeof text === 'string') return text
  return text[locale]
    ?? text[fallback]
    ?? Object.values(text)[0]
    ?? ''
}

// A localized literal in the wire's JSON-LD expanded form:
// `[{ '@value': 'Zwei Jahre', '@language': 'de' }, ...]`.
interface WireLangValue {
  readonly '@value': string
  readonly '@language': string
}

// True when v is the expanded language-array form, as
// opposed to a locale hash (plain object) or a string.
export function isLanguageArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0 && v.every((e) =>
    !!e && typeof e === 'object'
    && typeof (e as Record<string, unknown>)['@value'] === 'string'
    && typeof (e as Record<string, unknown>)['@language'] === 'string')
}

// Fold any wire localized shape to the model's
// `string | { locale: text }`. The expanded array form
// collapses to a hash; a string or existing hash passes
// through; anything else (incl. null) becomes ''.
export function foldLocale(v: unknown): SnapshotLocalizedText {
  if (typeof v === 'string') return v
  if (isLanguageArray(v)) {
    const out: Record<string, string> = {}
    for (const e of v as ReadonlyArray<WireLangValue>) {
      out[e['@language']] = e['@value']
    }
    return out
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Readonly<Record<string, string>>
  }
  return ''
}

export type LifecycleStatus =
  | 'draft'
  | 'placed_on_market'
  | 'in_use'
  | 'repair'
  | 'refurbished'
  | 'collected'
  | 'recycled'
  | 'end_of_life'
  | 'suspended'

export type EventType =
  | 'published'
  | 'lifecycle_transition'
  | 'recalled'
  | 'rolled_back'
  | 'registered_with_eu'
  | 'repair'
  | 'refurbished'
  | 'collected'
  | 'recycled'
  | 'inspection'

export type Rating =
  | 'veryBad'
  | 'bad'
  | 'neutral'
  | 'good'
  | 'veryGood'

// Backend serializer historically emitted snake_case
// rating tokens (`very_bad`, `very_good`); the SPA
// renders the camelCase form (`veryBad`, `veryGood`)
// because the i18n bundles and sprite map use that.
// canonicalRating normalises either wire form to the
// SPA-internal canonical and returns undefined for
// unknown strings so consumers can fall back to a
// no-rating render. The middle three tokens (`bad`,
// `neutral`, `good`) are identical across conventions.
export function canonicalRating(raw: unknown): Rating | undefined {
  if (typeof raw !== 'string') return undefined
  if (raw === 'very_bad') return 'veryBad'
  if (raw === 'very_good') return 'veryGood'
  if (
    raw === 'veryBad' || raw === 'bad' || raw === 'neutral'
    || raw === 'good' || raw === 'veryGood'
  ) return raw
  return undefined
}

// The wire lifecycle token (`dppStatus`) is camelCase
// (`inUse`, `placedOnMarket`); the SPA's internal enum and
// its i18n + colour maps are snake_case. canonicalStatus
// maps either convention to the internal form. Already
// snake_case input passes through; an unknown token falls
// back to 'draft' so the renderer never breaks on an
// unmapped lifecycle state.
const STATUS_BY_WIRE: Readonly<Record<string, LifecycleStatus>> = {
  draft: 'draft',
  placedOnMarket: 'placed_on_market',
  placed_on_market: 'placed_on_market',
  inUse: 'in_use',
  in_use: 'in_use',
  repair: 'repair',
  refurbished: 'refurbished',
  collected: 'collected',
  recycled: 'recycled',
  endOfLife: 'end_of_life',
  end_of_life: 'end_of_life',
  suspended: 'suspended',
}

export function canonicalStatus(raw: unknown): LifecycleStatus {
  if (typeof raw !== 'string') return 'draft'
  return STATUS_BY_WIRE[raw] ?? 'draft'
}

// Line-item inside a composition's `entries` array
// (the rows of a material breakdown). The composition
// itself is wrapped by a PropertyValue with kind
// 'composition'; this is the per-row data shape.
export interface CompositionEntry {
  readonly name: SnapshotLocalizedText
  readonly percent: number

  // Segment colour is presentation, not signed data: the
  // wire omits it and the donut assigns a palette colour
  // by index. An explicit colour is honoured when present.
  readonly color?: string
  readonly countryCode?: string

  // Optional pointer at a versioned library object on
  // the public bucket (e.g. `component/organic-cotton/v3.json`,
  // resolved against the manifest URL the same way
  // `epcisUrl` is). When present, the renderer fetches
  // the object lazily on click and opens it in the
  // library modal. Not part of the proof chain; integrity
  // is by path-versioning rather than a content hash.
  readonly libraryRef?: string

  // Optional sustainability rating, five-step enum. Drives
  // the row chip and the modal lead.
  readonly rating?: Rating
}

// The SPA's flat representation of a product attribute.
// Renderers consume a single `ReadonlyArray<PropertyValue>`
// off `snapshot.properties` and route each row to the
// right surface by `value.type`:
//
//   scalar       -> property card  (dpp-property-cards)
//   list         -> badge group    (dpp-badge-lists)
//   longText     -> accordion      (dpp-accordions)
//   composition  -> donut          (dpp-compositions)
//
// The classification is by content shape, never by a
// separate render-hint field. The snapshot's signed
// bytes carry the underlying data; presentation
// decisions stay on the SPA side.
//
// `name` is a SnapshotLocalizedText because it lives in
// the signed bytes; `icon` survives as a small visual
// hint the publishing side ships per row.
export type PropertyValueKind =
  | {
      readonly type: 'scalar'

      // String or locale-hash. Numeric wire values keep a
      // `String(raw)` form here (for the longText-bridge
      // length checks and as a fallback); localized values
      // pass through and are resolved with tx() at render
      // time.
      readonly value: SnapshotLocalizedText

      // Set when the wire value was a bare number. The
      // renderer formats it for the active locale
      // (formatNumber: 87.3 -> "87,3" in de-DE) instead of
      // resolving `value` as text, so number rendering
      // follows the viewer's locale.
      readonly numeric?: number
      readonly unit?: string
    }
  | {
      readonly type: 'list'
      readonly items: ReadonlyArray<SnapshotLocalizedText>
    }
  | {
      readonly type: 'longText'
      readonly body: SnapshotLocalizedText
    }
  | {
      readonly type: 'composition'
      readonly entries: ReadonlyArray<CompositionEntry>
      readonly unit?: string
    }

// The flat data row the snapshot ships. Each row
// carries its data (`value`), its label (`name`), and
// the access-gating flags (`namespace`, `onDemand`)
// that gate on-demand and private rows.
// Presentation surface is chosen from `value.type` -
// scalar rows render as metric tiles unless they carry
// a namespace (in which case they land in the
// "additional product data" table); list / longText /
// composition rows route to their respective surfaces.
//
// The row carries no presentation hint. Its decorative
// icon is resolved from `key` through the external icon
// map (see src/icons.ts `iconForProperty`), so the
// regulatory data stays presentation-free and the
// type-to-icon vocabulary lives outside this bundle.
export interface PropertyValue {
  readonly key: string
  readonly name: SnapshotLocalizedText
  readonly value: PropertyValueKind

  // Access-gating: rows with a namespace participate in
  // the URL `?show=` filter. Rows with `onDemand: true`
  // stay hidden until their namespace is unlocked.
  // Category-3 (private) rows ship via the
  // privateProperties endpoint and carry both flags.
  readonly namespace?: string
  readonly onDemand?: boolean
}

// PropertyValue narrowed to a single value-kind. The
// renderers filter the flat presentation list by kind
// and operate on the narrowed shape; this alias keeps
// `value.{value,items,body,entries}` accessible without
// re-narrowing inside the renderer.
export type PropertyValueOf<T extends PropertyValueKind['type']> =
  PropertyValue & { value: Extract<PropertyValueKind, { type: T }> }

// Type-guard factory for the filter pattern:
//   rows.filter(propertyIsKind('scalar'))
// returns ReadonlyArray<PropertyValueOf<'scalar'>>.
// One line at the call site, one place to change if the
// discriminator key ever moves off `value.type`.
export function propertyIsKind<T extends PropertyValueKind['type']>(
  kind: T,
): (p: PropertyValue) => p is PropertyValueOf<T> {
  return (p): p is PropertyValueOf<T> => p.value.type === kind
}

// Item inside a `list`-typed component property value
// (component library JSON, not signed snapshot bytes).
// The optional rating drives whether the surrounding
// list renders as a smiley-prefixed UL (any item rated)
// or an inline comma-separated phrase (no items rated).
export interface ComponentPropertyListItem {
  readonly text: SpaLocalizedText
  readonly rating?: Rating
}

// Discriminated union of value kinds the library modal
// renders. Lives alongside ComponentProperty so the same
// shape can describe library JSON objects fetched at
// runtime.
export type ComponentPropertyValue =
  | { readonly type: 'text'; readonly value: SpaLocalizedText }
  | { readonly type: 'percent'; readonly value: number }
  | {
      readonly type: 'decimal'
      readonly value: number
      readonly unit?: string
    }
  | {
      readonly type: 'enum'
      readonly value: string
      readonly label: SpaLocalizedText
    }
  | {
      readonly type: 'list'
      readonly items: ReadonlyArray<ComponentPropertyListItem>
    }

export interface ComponentProperty {
  readonly key: string
  readonly label: SpaLocalizedText
  readonly value: ComponentPropertyValue
}

export interface ComponentReference {
  readonly label: SpaLocalizedText
  readonly href: string
}

// Result of a library lookup. Fetched live from the
// public bucket at modal-open time; not part of the
// signed snapshot. The renderer shows these rows below
// the snapshot-frozen lead (percent + rating).
export interface ComponentLookup {
  readonly id: string
  readonly version?: number
  readonly name?: SpaLocalizedText
  readonly properties: ReadonlyArray<ComponentProperty>
  readonly references?: ReadonlyArray<ComponentReference>
}

// Per-image variant URLs inside a snapshot. The
// snapshot's JSON-LD hash transitively covers both
// URLs, so the image identity is version-bound. The
// snapshot only promises integrity ("these URLs were
// the ones the issuer signed against"), not
// availability; keeping the bytes alive across years
// is the host's responsibility, and each variant's
// content-addressed filename (the hash suffix) is the
// authoritative integrity reference.
export interface SnapshotImage {
  readonly thumbnail: string
  readonly large: string
}

// Self-contained per-version render payload. Each
// snapshot is signed independently and the regulator's
// archive must be able to validate one snapshot from
// Vault standalone, so the entire visible product
// state (issuer, product, manufacturer, composition,
// description, images) ships inside the snapshot
// alongside the proof set. The renderer reads the
// active version's snapshot directly; there is no
// separate "base Dpp" that snapshots diff against.
// Per-version property delta against the prior version: the
// `dpp:ChangeSet` the backend emits on v2+. Each array is a
// set of `propertyID`s; the renderer resolves them to labels
// (added / modified from this version's rows, removed from
// the prior version's). An absent block means "no delta
// available", not "nothing changed". Arrays are normalized
// to always-present (empty where the wire omits them).
export interface ChangeSet {
  readonly added: ReadonlyArray<string>
  readonly removed: ReadonlyArray<string>
  readonly modified: ReadonlyArray<string>
}

export interface DppSnapshot {
  readonly version: number
  readonly publishedAt: string
  readonly code: string
  readonly status: LifecycleStatus
  readonly issuer: Organization
  readonly platform: Organization
  readonly product: DppProduct

  // The flat data rows the renderer reads. Each row's
  // `value.type` chooses its presentation surface
  // (scalar -> metric tile or detail table, list ->
  // badge group, longText -> accordion, composition ->
  // donut); `namespace` + `onDemand` carry the
  // access-gating semantics that drove the legacy
  // category split.
  readonly properties: ReadonlyArray<PropertyValue>

  // Category-3 (private) rows present only in the
  // Vault snapshot, never on the Public-bucket bytes
  // the CDN serves. On the wire from the
  // manifest.versions[current].privateProperties.url
  // endpoint, this same key wraps the filtered subset
  // the current user is authorised to read.
  readonly privateProperties?: ReadonlyArray<PropertyValue>

  // SHA-256 of the previous version's canonical body
  // (the same digest the manifest stores in
  // versions[N-1].hashValue). Part of this snapshot's
  // signed payload, so tampering with the chain link
  // breaks the proof signature too. Absent on v1.
  // The scrub path checks this in actions.ts to surface
  // a content-continuity verdict alongside the
  // per-snapshot proof verdict.
  readonly priorVersionHash?: string

  // The prior version number (this snapshot's `priorVersion`
  // on the wire); pairs with priorVersionHash. Absent on v1.
  readonly priorVersion?: number

  // Property-level delta since priorVersion. Absent on v1,
  // legacy snapshots, and versions that changed no property.
  readonly changedProperties?: ChangeSet

  // Multi-authority eddsa-jcs-sha256 proof set. Three
  // entries point at the issuer's verificationMethod
  // URLs and share one Ed25519 signature; two point at
  // platform URLs and share another. A snapshot is
  // authentic when at least one entry from each
  // authority verifies (the default "any-issuer-and-
  // any-platform" rule enforced in src/crypto/verify.ts).
  readonly proof: ReadonlyArray<SnapshotProof>
}

// One proof entry. Only `verificationMethod` + `proofValue`
// are required: the proof set repeats a single signature
// across several locations of the same key, and every
// entry after the first omits the proof metadata (`type`,
// `cryptosuite`, `created`, `proofPurpose`) because the
// reduced profile does not sign the proof options. The
// verifier reads only the method + value per entry.
//
// The signing scheme is `eddsa-jcs-sha256`: Ed25519 over a
// single SHA-256 of the JCS-canonical body. It is a
// deliberately non-standard profile, NOT the W3C
// eddsa-jcs-2022 suite (which binds a per-proof config
// hash). `cryptosuite` is the backend-supplied wire label
// and is typed `string` because the renderer never
// branches on it (it is display-only); the publisher
// backend owns the exact label value.
export interface SnapshotProof {
  readonly type?: 'DataIntegrityProof'
  readonly cryptosuite?: string
  readonly created?: string
  readonly proofPurpose?: 'assertionMethod'
  readonly verificationMethod: string
  readonly proofValue: string
}

export interface DppEvent {
  readonly id: string
  readonly eventType: EventType
  readonly occurredAt: string

  // PII fields the production EPCIS sidecar omits from
  // the public artefact (`actorLabel`, `description`).
  // The SPA renders them when present; in production
  // they only appear when the authority-tool embed
  // overlays them from a separate authenticated fetch.
  readonly actorLabel?: string
  readonly statusFrom?: LifecycleStatus
  readonly statusTo?: LifecycleStatus
  readonly description?: SnapshotLocalizedText
  readonly versionNumber?: number
  readonly snapshot?: DppSnapshot

  // When true, this event was tagged regulator-only on
  // the source row; defensive filter against an issuer
  // mis-publishing a private event to the public feed.
  readonly private?: boolean
}

export interface DppManufacturer {
  readonly name: string
  readonly street: string
  readonly city: string
  readonly country: string
}

// Identity block on the snapshot: name, brand, images,
// manufacturer. Property data lives on the flat
// snapshot.properties array (PropertyValue rows); the
// product type carries no presentation arrays.
export interface DppProduct {
  readonly name: SnapshotLocalizedText
  readonly brand: string
  readonly description: SnapshotLocalizedText
  readonly category?: SnapshotLocalizedText
  readonly gtin?: string
  readonly weight?: number
  readonly weightUnit?: string
  readonly images: ReadonlyArray<SnapshotImage>
  readonly manufacturer: DppManufacturer

  // Aggregate sustainability rating for the product,
  // typically computed upstream from each component's
  // rating (which itself rolls up its rated properties).
  // The DPP renderer takes the value verbatim; it does
  // not recompute. Drives the smiley prefix on the
  // product name in the hero.
  readonly rating?: Rating
}

// The issuer/platform shape is the schema.org-style
// Organization block defined in src/archive.ts; both
// the manifest and the snapshot reference it. Logo
// URLs and dimensions are expressed as CSS custom
// properties via the issuer's branding stylesheet,
// not on the issuer block. The locale list is a
// DPP-level concern carried on the manifest.
