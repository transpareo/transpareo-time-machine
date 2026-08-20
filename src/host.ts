/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Host-injection data layer. The custom element's `src`
 * attribute points at a DPP manifest URL or a single
 * signed snapshot URL; this module fetches it, detects
 * which it is, and in manifest mode also fetches the
 * sibling artefacts (the current snapshot and the EPCIS
 * document, which carries the public events feed), then
 * exposes everything as signals the rest of the SPA reads.
 * A lone snapshot has no version list and no EPCIS, so the
 * timeline + events stay empty and `manifest` stays null.
 *
 * Fetch flow:
 *
 *   1. fetch(src) -> manifest
 *   2. fetch(resolve(manifest.versions[current].url, src))
 *      -> current snapshot
 *   3. fetch(resolve(manifest.epcisUrl, src))
 *      -> EPCIS document (single artefact; the renderer
 *      derives DppEvent[] from its transpareo:* event
 *      extensions in state.ts)
 *
 * Older versions are loaded lazily: ensureVersionLoaded
 * in actions.ts pulls a target version on demand, and
 * bootstrapVerify in bootstrap.ts pre-warms the next
 * few versions on either side of the active one so a
 * single-step scrub renders without a CDN round-trip.
 * Each fetched snapshot is verified via the
 * crypto/verify module and cached.
 *
 * URLs inside the manifest are resolved against the
 * manifest's own URL via `new URL(rel, base)`. The
 * renderer makes no assumption about the issuer's
 * bucket layout: forks, CDNs, and CNAME publishers can
 * use whatever path scheme they like as long as the
 * manifest is well-formed.
 */

import { signal } from '@/reactive/signals'
import { readJsonResponse } from '@/fetch-json'
import { detectArtefact, snapshotBody } from '@/artefact-detect'
import type { DppManifest, Organization, SignedSnapshot } from '@/archive'
import type {
  DppSnapshot, DppProduct, DppManufacturer, SnapshotImage,
  PropertyValue, PropertyValueKind, SnapshotLocalizedText, SnapshotProof,
  ChangeSet,
} from '@/types'
import {
  canonicalRating, canonicalStatus, foldLocale, regionLiteral,
} from '@/types'
import {
  classifyWireValue, bridgeLongTextGroups, numericWireValue,
} from '@/property-classify'
import type { EpcisDocument } from '@/epcis'

export type LoadState = 'idle' | 'loading' | 'ready' | 'error' | 'retired'

export const loadState = signal<LoadState>('idle')
export const loadError = signal<string | null>(null)

export const manifest = signal<DppManifest | null>(null)

// Active "current" version number. In manifest mode it
// mirrors `manifest.currentVersion`; in single-snapshot
// mode (no manifest) it is the lone snapshot's `version`,
// so the state layer can resolve the current snapshot
// without a version list.
export const currentVersion = signal<number>(0)

// Adapted render models, keyed by version: what the
// rendering derivations in state.ts read.
export const snapshots = signal<Record<number, DppSnapshot>>({})

// Raw signed bytes as fetched, keyed by version. The
// proof verification and the priorVersionHash chain check
// hash these exactly as received (JCS of the body without
// `proof`), so they must stay byte-faithful and are kept
// separate from the adapted render models above.
export const rawSnapshots = signal<Record<number, SignedSnapshot>>({})
export const epcisDocument = signal<EpcisDocument | null>(null)

// URL of the manifest the SPA was booted from. Stored
// so ensureVersionLoaded can resolve relative version
// URLs against it later.
let manifestUrl: string | null = null

export function getManifestUrl(): string | null {
  return manifestUrl
}

// Monotonic boot counter. A later `src` attribute reboots
// the element via a fresh bootFrom; async work started
// under a previous boot compares its captured epoch
// against this and drops its result instead of writing a
// different DPP's data into the fresh caches. The verdict
// layer (actions.ensureVersionLoaded) reads it for the
// same reason.
let bootEpoch = 0

export function currentBootEpoch(): number {
  return bootEpoch
}

export async function bootFrom(src: string): Promise<void> {
  const epoch = ++bootEpoch
  loadState.set('loading')
  loadError.set(null)

  // A reboot must not leave the previous DPP's artefacts
  // readable while the new ones load (or after the new
  // boot fails). On the first boot these are empty anyway.
  manifest.set(null)
  currentVersion.set(0)
  snapshots.set({})
  rawSnapshots.set({})
  epcisDocument.set(null)

  // Normalize to an absolute URL so URL resolution
  // against the manifest's sibling URLs works whether
  // the host passed an absolute or document-relative
  // src.
  manifestUrl = new URL(src, window.location.href).toString()

  try {
    const data = await fetchSource(manifestUrl)
    if (epoch !== bootEpoch) return
    if (detectArtefact(data) === 'manifest') {
      await bootFromManifest(data as DppManifest, manifestUrl, epoch)
    } else {
      bootFromSnapshot(data as SignedSnapshot)
    }
    if (epoch === bootEpoch) loadState.set('ready')
  } catch (err) {
    if (epoch !== bootEpoch) return
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[host] boot failed:', message)
    loadError.set(message)
    loadState.set(err instanceof ManifestGoneError ? 'retired' : 'error')
  }
}

async function bootFromManifest(
  m: DppManifest, base: string, epoch: number,
): Promise<void> {
  manifest.set(m)
  currentVersion.set(m.currentVersion)

  const currentVersionUrl = resolveAgainst(
    base,
    m.versions.find((v) => v.number === m.currentVersion)?.url,
  )
  const epcisUrl = resolveAgainst(base, m.epcisUrl)
  if (!currentVersionUrl) {
    throw new Error('manifest is missing the current version URL')
  }
  if (!epcisUrl) {
    throw new Error('manifest is missing epcisUrl')
  }

  // The events sidecar is one mutable document under a
  // stable URL, like the manifest: it grows with every
  // event the publisher records, so it is revalidated
  // rather than replayed from the HTTP cache.
  const [current, epcis] = await Promise.all([
    fetchJson<SignedSnapshot>(currentVersionUrl),
    fetchJson<EpcisDocument>(epcisUrl, 'no-cache'),
  ])
  if (epoch !== bootEpoch) return

  storeSnapshot(current)
  epcisDocument.set(epcis)
}

// Single-snapshot mode: render one frozen version. No
// manifest (so no version list and no chain anchor) and no
// EPCIS sidecar (so no event timeline); the snapshot's own
// 2-of-2 proof still verifies via actions.ensureVersionLoaded.
function bootFromSnapshot(snap: SignedSnapshot): void {
  currentVersion.set(snap.version)
  storeSnapshot(snap)
}

// Thrown by fetchManifest when the manifest endpoint
// returns 404 or 410. The boot caller maps it to the
// 'retired' load state so the host element renders a
// "this passport has been retired" placeholder instead
// of the generic "could not load" message. The two
// status codes are treated identically: 410 is the
// explicit "intentionally gone" signal, 404 is what
// some authority deployments return for cancelled
// publishers today, and from the SPA's standpoint they
// both mean the same thing - the manifest is no longer
// served.
class ManifestGoneError extends Error {
  readonly status: number
  constructor(status: number, url: string) {
    super(`HTTP ${status} fetching ${url}`)
    this.name = 'ManifestGoneError'
    this.status = status
  }
}

// Cap every boot fetch so a stalled socket (captive
// portal, flaky mobile) rejects into the normal error
// path instead of leaving the boot spinner up forever.
const FETCH_TIMEOUT_MS = 15_000

// Sent on every artefact fetch. The `src` may be the
// passport's own URL, where a publisher implementing
// EN 18216 content negotiation serves either the HTML
// page or the JSON dataset from one URL; asking for
// JSON explicitly keeps that case deterministic.
// Static hosts serving fixed JSON files ignore it.
const ACCEPT_JSON = 'application/ld+json, application/json'

// Fetch the boot source, either a DPP manifest or a single
// signed snapshot. 404/410 means the resource is gone (the
// boot caller maps it to the 'retired' load state) for both
// shapes; the shape is then detected by `detectArtefact`.
async function fetchSource(
  url: string,
): Promise<DppManifest | SignedSnapshot> {
  // 'no-cache' revalidates the boot artefact instead of
  // trusting a stale HTTP-cache copy: the manifest is the
  // trust anchor for the whole version list, and a lingering
  // cached one widens the rollback window for free. Version
  // snapshots fetched later keep default caching; their bytes
  // are pinned by the manifest's hashValue, and the verdict
  // layer refetches them past the cache when they miss it.
  const res = await fetch(url, {
    credentials: 'omit',
    cache: 'no-cache',
    headers: { accept: ACCEPT_JSON },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (res.status === 404 || res.status === 410) {
    throw new ManifestGoneError(res.status, url)
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`)
  }
  return readJsonResponse<DppManifest | SignedSnapshot>(res)
}

export interface SnapshotFetchOptions {
  // Read the bytes from the origin instead of the browser's
  // HTTP cache. A publisher that republishes a version URL
  // leaves the visitor holding the previous publish, which
  // renders but no longer matches the manifest; the verdict
  // layer sets this to re-read those bytes before it judges
  // them.
  readonly reload?: boolean
}

// Pull a version's snapshot bytes from the CDN and
// cache it. Called from actions.ensureVersionLoaded as
// the visitor scrubs to a previously-unloaded version.
export async function fetchSnapshot(
  versionNumber: number,
  options: SnapshotFetchOptions = {},
): Promise<DppSnapshot | null> {
  const epoch = bootEpoch
  const m = manifest.peek()
  if (!m || !manifestUrl) return null
  const entry = m.versions.find((v) => v.number === versionNumber)
  if (!entry) return null
  const url = resolveAgainst(manifestUrl, entry.url)
  if (!url) return null

  const mode = options.reload ? 'reload' : 'default'
  const raw = await fetchJson<SignedSnapshot>(url, mode)

  // A reboot landed while this fetch was in flight: the
  // bytes belong to the previous DPP and must not enter
  // the fresh caches (version numbers collide across DPPs).
  if (epoch !== bootEpoch) return null

  // A cache-busting read landed while this default read was
  // in flight. Its bytes came from the origin; these came
  // from the browser's HTTP cache and must not replace them.
  if (!options.reload && rawSnapshots.peek()[versionNumber]) {
    return snapshots.peek()[versionNumber] ?? null
  }
  return storeSnapshot(raw)
}

// Cache one fetched snapshot in both representations: the
// raw bytes for verification + chain hashing, and the
// adapted render model the rendering layer reads.
function storeSnapshot(raw: SignedSnapshot): DppSnapshot {
  const model = toRenderModel(raw)
  // Key both caches by the model version: a VC snapshot
  // carries its version under credentialSubject, so raw.version
  // is absent and only the adapted model has it resolved.
  rawSnapshots.update((cache) => ({ ...cache, [model.version]: raw }))
  snapshots.update((cache) => ({ ...cache, [model.version]: model }))
  return model
}

// Wire shape of the signed snapshot the adapter reads.
// Only the fields the render model needs are declared;
// the raw bytes (full @context, identifiers, regulatory
// scalars, proof) are kept verbatim in rawSnapshots for
// verification.
interface WireSnapshot {
  readonly version: number
  readonly publishedAt: string
  readonly passportAlias?: string
  readonly code?: string

  // The wire ships the GTIN inside the identifiers block;
  // a top-level field is accepted as a fallback (the
  // archive type declares one).
  readonly gtin?: string
  readonly identifiers?: {
    readonly code?: string
    readonly gtin?: string
  }
  readonly dppStatus?: string
  readonly status?: string

  // The product rating sits at the top level per the
  // contract; `product.rating` is accepted as a fallback.
  readonly rating?: unknown
  readonly issuer: Organization
  readonly platform: Organization
  readonly product: WireProduct

  // Properties are nested under product per the contract;
  // a top-level array is accepted as a fallback.
  readonly properties?: ReadonlyArray<WireProperty>
  readonly priorVersion?: number
  readonly priorVersionHash?: string
  readonly changedProperties?: unknown
  readonly proof?: ReadonlyArray<SnapshotProof>
}

interface WireProduct {
  readonly name?: SnapshotLocalizedText
  readonly brand?: string
  readonly description?: SnapshotLocalizedText
  readonly category?: SnapshotLocalizedText
  readonly weight?:
    | number
    | { readonly value?: unknown; readonly unitCode?: string }
  readonly weightUnit?: string
  readonly images?: ReadonlyArray<SnapshotImage | string>
  readonly manufacturer?: WireManufacturer
  readonly properties?: ReadonlyArray<WireProperty>
  readonly rating?: unknown
}

interface WireManufacturer {
  readonly name?: string
  readonly street?: string
  readonly city?: string
  readonly country?: string
  readonly countryCode?: string
}

export interface WireProperty {
  readonly propertyID?: string
  readonly key?: string
  readonly name?: SnapshotLocalizedText
  readonly value?: unknown
  readonly unitText?: string
  readonly unitCode?: string
  readonly access?: 'onDemand' | 'legitimateInterest' | 'authorities'
}

// UN/CEFACT unit codes mapped to a display unit. An
// unmapped code falls through to itself; the free-text
// `unitText` is preferred when the wire carries one.
const UNIT_BY_CODE: Readonly<Record<string, string>> = {
  KGM: 'kg', GRM: 'g', MGM: 'mg', LTR: 'L', MLT: 'ml',
  MTR: 'm', CMT: 'cm', MMT: 'mm', P1: '%',
}

function unitCodeToText(code: string | undefined): string | undefined {
  if (!code) return undefined
  return UNIT_BY_CODE[code] ?? code
}

// Map the raw signed snapshot to the render model the
// rendering layer reads. Field names align to the SPA's
// internal model: dppStatus -> status, passportAlias /
// identifiers.code -> code, the weight QuantitativeValue
// -> weight + weightUnit, and each property's typed value
// is derived from its shape by classifyWireValue.
// Normalize the wire `changedProperties` block to a
// ChangeSet with always-present string arrays. Returns
// undefined when the block is absent or carries no entries,
// so an empty delta renders nothing rather than an empty
// section. Non-string array members are dropped.
function adaptChangeSet(raw: unknown): ChangeSet | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const ids = (v: unknown): ReadonlyArray<string> =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  const set = { added: ids(o.added), removed: ids(o.removed), modified: ids(o.modified) }
  if (!set.added.length && !set.removed.length && !set.modified.length) {
    return undefined
  }
  return set
}

// An ecdsa-sd snapshot is a Verifiable Credential; the
// shared snapshotBody unwraps it to the same flat shape
// the eddsa-jcs snapshot already has, so one adapter
// serves both. The credentialSubject uses the same EN
// 18223 wire fields (language arrays, PropertyValue
// rows), so no per-field translation is needed here.
function unwrapCredential(raw: SignedSnapshot): WireSnapshot {
  return snapshotBody(
    raw as unknown as Record<string, unknown>,
  ) as unknown as WireSnapshot
}

export function toRenderModel(raw: SignedSnapshot): DppSnapshot {
  const w = unwrapCredential(raw)
  const changed = adaptChangeSet(w.changedProperties)
  return {
    version: w.version,
    publishedAt: w.publishedAt,
    code: w.passportAlias ?? w.identifiers?.code ?? w.code ?? '',
    status: canonicalStatus(w.dppStatus ?? w.status),
    issuer: w.issuer,
    platform: w.platform,
    product: adaptProduct(w.product, w.rating, w.identifiers?.gtin ?? w.gtin),
    properties: adaptProperties(w.product?.properties ?? w.properties ?? []),
    ...(typeof w.priorVersion === 'number' ? { priorVersion: w.priorVersion } : {}),
    ...(w.priorVersionHash ? { priorVersionHash: w.priorVersionHash } : {}),
    ...(changed ? { changedProperties: changed } : {}),
    proof: w.proof ?? [],
  }
}

function adaptProduct(
  p: WireProduct | undefined, topRating?: unknown, gtin?: string,
): DppProduct {
  // Rating is top-level in the contract; fall back to
  // product.rating for snapshots that carry it there.
  const rating = canonicalRating(topRating ?? p?.rating)
  return {
    name: foldLocale(p?.name),
    brand: p?.brand ?? '',
    description: foldLocale(p?.description),
    ...(p?.category != null ? { category: foldLocale(p.category) } : {}),
    ...(gtin ? { gtin } : {}),
    ...adaptWeight(p),
    images: normalizeImages(p?.images),
    manufacturer: adaptManufacturer(p?.manufacturer),
    ...(rating ? { rating } : {}),
  }
}

// Read the product weight from either a QuantitativeValue
// object (`{ value, unitCode }`, its value a bare number or
// a decimal typed literal) or a bare number + weightUnit,
// yielding the internal weight + weightUnit pair. Empty
// when there is no usable value.
function adaptWeight(
  p: WireProduct | undefined,
): { weight?: number; weightUnit?: string } {
  const w = p?.weight
  if (typeof w === 'number') {
    return { weight: w, ...(p?.weightUnit ? { weightUnit: p.weightUnit } : {}) }
  }
  if (w && typeof w === 'object') {
    const numeric = numericWireValue(w.value)
    if (numeric != null) {
      const unit = unitCodeToText(w.unitCode)
      return { weight: numeric, ...(unit ? { weightUnit: unit } : {}) }
    }
  }
  return {}
}

function adaptManufacturer(
  m: WireManufacturer | undefined,
): DppManufacturer {
  return {
    name: m?.name ?? '',
    street: m?.street ?? '',
    city: m?.city ?? '',
    country: m?.country ?? regionLiteral(m?.countryCode) ?? '',
  }
}

// Map the wire property rows to the render model. The
// access tier drives the gating fields: an `onDemand` row
// carries its propertyID as the `namespace` the ?show=
// filter matches and stays hidden until unlocked; the
// non-public tiers (`legitimateInterest`, `authorities`)
// are dropped here so they never paint from the public
// bytes (the post-auth fetch supplies the legitimate-
// interest rows). The value surface is classified by
// shape, then a grouping pass keeps accordion runs
// coherent.
function adaptProperties(
  rows: ReadonlyArray<WireProperty>,
): ReadonlyArray<PropertyValue> {
  const isPublic = (r: WireProperty): boolean =>
    r.access !== 'legitimateInterest' && r.access !== 'authorities'
  return buildRows(rows.filter(isPublic), buildPublicRow)
}

// Adapt the rows the post-auth endpoint returns into the
// additional-data section. The endpoint serves the full
// ordered set to a logged-in person with legitimate
// interest; the `legitimateInterest` rows are the ones
// absent from the public bytes, so those are the rows to
// surface here. `authorities` rows are served only via the
// authority API, never to this reader, so they are dropped
// defensively. Each surfaced row is given a namespace so it
// lands in the detail table; the public + onDemand rows
// already paint from the snapshot, so they are left out to
// avoid a duplicate render.
export function adaptPrivateRows(
  rows: ReadonlyArray<WireProperty>,
): ReadonlyArray<PropertyValue> {
  return buildRows(
    rows.filter((r) => r.access === 'legitimateInterest'),
    buildPrivateRow,
  )
}

function buildRows(
  rows: ReadonlyArray<WireProperty>,
  build: (r: WireProperty, value: PropertyValueKind) => PropertyValue,
): ReadonlyArray<PropertyValue> {
  const kinds = bridgeLongTextGroups(
    rows.map((r) =>
      classifyWireValue(r.value, r.unitText ?? unitCodeToText(r.unitCode)),
    ),
  )
  return rows.map((r, i) => build(r, kinds[i]))
}

function buildPublicRow(
  r: WireProperty, value: PropertyValueKind,
): PropertyValue {
  const key = r.propertyID ?? r.key ?? ''
  const gated = r.access === 'onDemand'
  return {
    key,
    name: foldLocale(r.name),
    value,
    ...(gated ? { namespace: key, onDemand: true } : {}),
  }
}

function buildPrivateRow(
  r: WireProperty, value: PropertyValueKind,
): PropertyValue {
  const key = r.propertyID ?? r.key ?? ''
  return {
    key,
    name: foldLocale(r.name),
    value,
    namespace: key,
  }
}

// Coerce a flat-string image entry to the {thumbnail,
// large} pair the gallery reads; object entries pass
// through unchanged.
function normalizeImages(
  images: ReadonlyArray<SnapshotImage | string> | undefined,
): ReadonlyArray<SnapshotImage> {
  if (!images || images.length === 0) return []
  const after: SnapshotImage[] = []
  for (const entry of images) {
    if (typeof entry === 'string') {
      after.push({ thumbnail: entry, large: entry })
    } else {
      after.push(entry)
    }
  }
  return after
}

function resolveAgainst(base: string, relative: string | undefined): string | null {
  if (!relative) return null
  try {
    return new URL(relative, base).toString()
  } catch {
    return null
  }
}

async function fetchJson<T>(
  url: string, cache: RequestCache = 'default',
): Promise<T> {
  const res = await fetch(url, {
    credentials: 'omit',
    cache,
    headers: { accept: ACCEPT_JSON },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`)
  }
  return readJsonResponse<T>(res)
}
