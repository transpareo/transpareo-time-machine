/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Seed emitter. Reads one validated `Fixture` (the
 * parsed YAML) and writes the four published JSON
 * artefacts the SPA consumes, all under
 * `public/{issuer.handle}/dpp/{code}/`:
 *
 *   - manifest.json: the entry point; lists every
 *     version's URL + hash plus the epcisUrl
 *     pointer, the issuer + platform display
 *     names, and a signature block.
 *   - v/{N}.json: one self-contained snapshot per
 *     version (issuer + product + version-specific
 *     composition/description/images + 5-entry proof
 *     set).
 *   - events.json: events sidecar, snake_case wire
 *     shape; the host module translates to the
 *     renderer's DppEvent type.
 *   - epcis.json: EPCIS 2.0 ObjectEvent projection plus a
 *     document-level platform signature block.
 *
 * Public-tier artefacts are gitignored; every dev
 * regenerates locally via `npm run seed`. The renderer
 * has zero compile-time knowledge of these files; the
 * `<transpareo-time-machine src="...">` attribute
 * names a manifest URL at runtime and the SPA's fetch
 * flow does the rest.
 */

import {
  mkdir, writeFile, rm, readdir, readFile, stat,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { canonicalize } from '../../src/crypto/jcs.ts';
import type { Fixture } from './schema.ts';

type FixtureSnapshot = Fixture['snapshots'][number];
import type { ProofEntry, SnapshotSigner } from './signing.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const FIXTURES_ROOT = join(ROOT, 'fixtures');
const PUBLIC_ROOT = join(ROOT, 'public');
const GENERATED_ROOT = join(ROOT, 'src', 'fixtures', '_generated');

export interface ImageVariants {
  readonly thumbnail: string;
  readonly large: string;
}
export type ImageMap = Readonly<Record<string, ImageVariants>>;

export interface BrandingAssets {
  readonly cssBody: string;
  readonly logoUrl?: string;
  readonly logoWidth?: number;
  readonly faviconUrl?: string;
  readonly icons: ReadonlyArray<{ size: number; url: string }>;
}

export async function emitFixture(
  fixture: Fixture,
  images: ImageMap,
  branding: BrandingAssets | null,
  signer: SnapshotSigner,
): Promise<string> {
  const id = fixture.id;
  const code = fixture.code;
  const dir = join(PUBLIC_ROOT, id, 'dpp', code);
  const versionsDir = join(dir, 'v');
  await mkdir(versionsDir, { recursive: true });

  // Build per-version self-contained snapshots first;
  // the manifest reads each version's signed bytes for
  // hashValue + sizeBytes.
  const snapshotDocs = buildSnapshots(fixture, images, signer);
  await Promise.all(
    snapshotDocs.map((s) =>
      writeFile(
        join(versionsDir, `${s.version}.json`),
        JSON.stringify(s, null, 2) + '\n',
      ),
    ),
  );

  const epcisDoc = buildEpcis(fixture, signer);
  const manifestDoc = buildManifest(fixture, snapshotDocs, signer);

  const writes: Promise<unknown>[] = [
    writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify(manifestDoc, null, 2) + '\n',
    ),
    writeFile(
      join(dir, 'epcis.json'),
      JSON.stringify(epcisDoc, null, 2) + '\n',
    ),
  ];

  // Publisher-level branding stylesheet, referenced
  // from the embedding HTML shell as a static <link>.
  // Written once per issuer (not per DPP); the most
  // recently seeded fixture under a given issuer
  // wins, which matches the production model where
  // every DPP under one issuer shares one branding
  // sheet.
  if (branding?.cssBody) {
    const brandingDir = join(PUBLIC_ROOT, id);
    await mkdir(brandingDir, { recursive: true });
    writes.push(
      writeFile(join(brandingDir, 'branding.css'), branding.cssBody),
    );
  }

  // Publisher-level icon map: the row key -> sprite symbol
  // id table the SPA joins on, served beside branding.css
  // and pointed at by the shell's `icon-map-src`. The
  // signed snapshot carries no icon, so this is the only
  // place the type-to-icon mapping lives; it is per fixture,
  // so each publisher's mapping is independently adjustable.
  const iconMapDir = join(PUBLIC_ROOT, id);
  await mkdir(iconMapDir, { recursive: true });
  writes.push(
    writeFile(
      join(iconMapDir, 'icon-map.json'),
      JSON.stringify(buildIconMap(fixture), null, 2) + '\n',
    ),
  );

  // Component-library JSONs (one tree per slug, each
  // file path-versioned). Authored as fixture content
  // under fixtures/<id>/library/<slug>/v<N>.json; the
  // seed mirrors the tree into the public bucket at
  // public/<id>/dpp/<code>/component/<slug>/v<N>.json
  // so the snapshot's relative `libraryRef` resolves
  // when the modal fetches it.
  writes.push(emitLibrary(id, dir));

  await Promise.all(writes);

  // Older runs may have written bundled TS modules into
  // src/fixtures/_generated/<id>/; remove that tree on
  // every seed so a stale bundle never sneaks into the
  // production import graph.
  await rm(join(GENERATED_ROOT, fixture.id), {
    recursive: true,
    force: true,
  });

  return dir;
}

async function emitLibrary(
  fixtureId: string, dppDir: string,
): Promise<void> {
  const src = join(FIXTURES_ROOT, fixtureId, 'library');
  const exists = await stat(src).then(() => true).catch(() => false);
  if (!exists) return;
  const dest = join(dppDir, 'component');
  await rm(dest, { recursive: true, force: true });
  await copyTree(src, dest);
}

async function copyTree(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) await copyTree(s, d);
    else await writeFile(d, await readFile(s));
  }
}

// ─── Snapshots (self-contained) ───────────────────

interface SnapshotOut {
  readonly version: number;
  readonly publishedAt: string;
  readonly proof: ProofEntry[];
  readonly [key: string]: unknown;
}

// ─── Contract identity, scalars + derivations ───────
// The snapshot carries the full target wire shape. Values
// that have no fixture source are derived deterministically
// from the DPP code (so re-seeds + the reproducibility
// check produce identical bytes) or set from constants.

const DPP_CONTEXT: ReadonlyArray<unknown> = [
  'https://schema.org',
  'https://w3id.org/security/data-integrity/v2',
  'https://ref.openepcis.io/extensions/common/core/dpp-core-context.jsonld',
  'https://transpareo.com/vocab/transpareo/v1',
  {
    // `name` and `description` ride the EN 18223 expanded
    // language-array form, so they carry their own
    // `@language` per entry and drop the container term.
    // `reason` (void / supersede note) stays a language map.
    reason: { '@container': '@language' },
  },
];

const DPP_SCHEMA_VERSION = '1.0';

// snake_case lifecycle status -> camelCase dppStatus.
const DPP_STATUS: Readonly<Record<string, string>> = {
  draft: 'draft', placed_on_market: 'placedOnMarket', in_use: 'inUse',
  repair: 'repair', refurbished: 'refurbished', collected: 'collected',
  recycled: 'recycled', end_of_life: 'endOfLife', suspended: 'suspended',
};

// Weight unit text -> UN/CEFACT code for the
// QuantitativeValue; unmapped units fall back to unitText.
const WEIGHT_UNIT_CODE: Readonly<Record<string, string>> = {
  g: 'GRM', kg: 'KGM', mg: 'MGM', t: 'TNE',
};

// Country name -> ISO 3166-1 alpha-2 for the manufacturer
// countryCode; unmapped names pass through unchanged.
const COUNTRY_ISO: Readonly<Record<string, string>> = {
  Portugal: 'PT', Germany: 'DE', Italy: 'IT', France: 'FR',
  Spain: 'ES', Poland: 'PL', China: 'CN', 'United States': 'US',
};

// Deterministic, well-formed urn:uuid from a seed (a
// formatted SHA-256 with version/variant nibbles set, not
// a true RFC-4122 v5), so repeated seeds emit identical
// bytes.
function deterministicUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(12, 15)}`
    + `-a${h.slice(15, 18)}-${h.slice(18, 30)}`;
}

// Granularity is a property of the DPP type: battery
// passports identify a single item, apparel a batch.
const GRANULARITY_BY_REGULATION: Readonly<Record<string, string>> = {
  battery: 'item',
  textile: 'batch',
};

// Derived demo instance id (no real per-unit data in the
// fixtures); stable across re-seeds.
function instanceIdOf(code: string, prefix: string): string {
  const h = createHash('sha256').update(code).digest('hex')
    .slice(0, 6).toUpperCase();
  return `${prefix}${h}`;
}

// Always a URI, at the granularity's resolution: a GS1
// Digital Link with the serial (/21/) for item, the batch
// (/10/) for batch, the GTIN alone for model, else the
// passport's own urn:uuid.
function uniqueProductIdentifierOf(
  gtin: string | undefined,
  dppId: string,
  granularity: string,
  instanceId: string | undefined,
): string {
  if (!gtin) return dppId;
  const base = `https://id.gs1.org/01/${gtin}`;
  if (granularity === 'item' && instanceId) return `${base}/21/${instanceId}`;
  if (granularity === 'batch' && instanceId) return `${base}/10/${instanceId}`;
  return base;
}

// Live resolver URL on the issuer's own host (its did:web).
function resolverUrlOf(did: string, alias: string): string {
  const host = did.startsWith('did:web:')
    ? did.slice('did:web:'.length).split(':')[0]
    : 'example.com';
  return `https://${host}/dpp/${alias}`;
}

function accessRightsOf(
  regulation: string | undefined,
): Record<string, unknown> {
  return {
    '@type': 'dpp:AccessRights',
    publicLicense: 'https://creativecommons.org/licenses/by/4.0/',
    authorisedNote: '',
    restrictedNote: '',
    ...(regulation === 'battery'
      ? { regulatoryContext: 'https://eur-lex.europa.eu/eli/reg/2023/1542' }
      : {}),
  };
}

// Property-level delta between two versions' wire rows,
// keyed by `propertyID`: added / removed by presence,
// modified when the row's value changed. Mirrors the
// backend's `dpp:ChangeSet`; undefined when nothing moved,
// so v1 and unchanged versions carry no block.
function diffProperties(
  prior: ReadonlyArray<Record<string, unknown>>,
  current: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const valueOf = (
    rows: ReadonlyArray<Record<string, unknown>>,
  ): Map<string, string> => new Map(
    rows.map((p) => [String(p.propertyID), JSON.stringify(p.value)]),
  );
  const before = valueOf(prior);
  const after = valueOf(current);
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const [id, value] of after) {
    if (!before.has(id)) added.push(id);
    else if (before.get(id) !== value) modified.push(id);
  }
  for (const id of before.keys()) if (!after.has(id)) removed.push(id);
  if (!added.length && !removed.length && !modified.length) return undefined;
  return {
    '@type': 'dpp:ChangeSet',
    ...(added.length ? { added: added.sort() } : {}),
    ...(removed.length ? { removed: removed.sort() } : {}),
    ...(modified.length ? { modified: modified.sort() } : {}),
  };
}

function buildSnapshots(
  fixture: Fixture,
  images: ImageMap,
  signer: SnapshotSigner,
): SnapshotOut[] {
  const baseProduct = buildBaseProduct(fixture);
  const issuer = buildIssuer(fixture);
  const platform = buildPlatform(fixture);
  const ordered = fixture.snapshots
    .slice()
    .sort((a, b) => a.version - b.version);

  // Build sequentially so each snapshot can carry its
  // predecessor's content-addressed hash in
  // priorVersionHash. The chain link is part of the
  // signed body, so tampering with it breaks the proof.
  const out: SnapshotOut[] = [];
  let priorHash: string | undefined;
  let priorProps: ReadonlyArray<Record<string, unknown>> | undefined;
  for (const s of ordered) {
    const props = buildProperties(fixture, s);
    const changed = priorProps ? diffProperties(priorProps, props) : undefined;
    const snap = buildOneSnapshot(
      s, fixture, images, baseProduct, issuer, platform, signer,
      priorHash, changed,
    );
    out.push(snap);
    priorHash = snapshotHashOf(snap);
    priorProps = props;
  }
  return out;
}

function buildOneSnapshot(
  s: FixtureSnapshot,
  fixture: Fixture,
  images: ImageMap,
  baseProduct: Record<string, unknown>,
  issuer: Record<string, unknown>,
  platform: Record<string, unknown>,
  signer: SnapshotSigner,
  priorVersionHash: string | undefined,
  changedProperties: Record<string, unknown> | undefined,
): SnapshotOut {
  const productForVersion = applyVersionDiff(baseProduct, s, images);
  const properties = buildProperties(fixture, s);
  const dppId = deterministicUuid(fixture.code);
  const gtin = fixture.product.gtin;

  // Granularity follows the DPP type: battery -> item,
  // apparel -> batch. The instance id + the GS1 link
  // resolution match it.
  const granularity = GRANULARITY_BY_REGULATION[fixture.regulation ?? '']
    ?? 'model';
  const serial = granularity === 'item'
    ? instanceIdOf(fixture.code, 'SN-') : undefined;
  const batch = granularity === 'batch'
    ? instanceIdOf(fixture.code, 'LOT-') : undefined;

  // The body the signer hashes is everything except the
  // proof field, in the full target wire shape. The 5-entry
  // proof set is appended after. JCS sorts keys, so the
  // declaration order here is cosmetic.
  const body = {
    '@context': DPP_CONTEXT,
    '@type': 'dpp:DigitalProductPassport',
    digitalProductPassportId: dppId,
    uniqueProductIdentifier: uniqueProductIdentifierOf(
      gtin, dppId, granularity, serial ?? batch,
    ),
    passportAlias: fixture.code,
    '@id': resolverUrlOf(fixture.issuer.did, fixture.code),
    identifiers: {
      code: fixture.code,
      ...(gtin ? { gtin } : {}),
      ...(serial ? { serial } : {}),
      ...(batch ? { batch } : {}),
    },
    version: s.version,
    dppSchemaVersion: DPP_SCHEMA_VERSION,
    ...(s.version > 1 ? { priorVersion: s.version - 1 } : {}),
    ...(priorVersionHash ? { priorVersionHash } : {}),
    ...(changedProperties ? { changedProperties } : {}),
    publishedAt: s.published_at,
    dppStatus: DPP_STATUS[s.status] ?? s.status,
    granularity,
    ...(fixture.regulation ? { regulationCategory: fixture.regulation } : {}),

    // Rating is a top-level snapshot scalar, not a product
    // field.
    ...(fixture.product.rating ? { rating: fixture.product.rating } : {}),
    issuer,
    platform,
    accessRights: accessRightsOf(fixture.regulation),

    // Properties are nested under the product: they are
    // properties of the product, per the wire contract.
    product: { ...productForVersion, properties },
  };
  const proof = signer.signSnapshot(body as Record<string, unknown>);
  return { ...body, proof };
}

// Issuer block in the W3C JSON-LD shape. The slug is
// a seed-only path component used to lay out the
// public/ artefacts; it never makes it into the
// signed body.
function buildIssuer(fixture: Fixture): Record<string, unknown> {
  return {
    '@type': 'Organization',
    name: fixture.issuer.name,
    did: fixture.issuer.did,
  };
}

function buildPlatform(fixture: Fixture): Record<string, unknown> {
  return {
    '@type': 'Organization',
    name: fixture.platform.name,
    did: fixture.platform.did,
  };
}

// The product is the regulatory-identity block:
// name, brand, description, category, images,
// manufacturer. Presentation rows (metrics / lists /
// accordions / compositions) live on the flat
// snapshot.properties array; see buildProperties. The
// rating is a top-level snapshot scalar, emitted in
// buildOneSnapshot, not here.
function buildBaseProduct(fixture: Fixture): Record<string, unknown> {
  const p = fixture.product;
  return {
    '@type': 'Product',
    name: toWireLocalized(p.name),
    brand: p.brand,
    description: toWireLocalized(p.description),
    ...(p.category ? { category: toWireLocalized(p.category) } : {}),

    // gtin lives in the top-level `identifiers` block, not
    // on the product.
    ...adaptWeight(p.weight, p.weight_unit),
    images: [],
    manufacturer: buildManufacturer(p.manufacturer),
  };
}

// weight (+ unit text) -> the QuantitativeValue the
// contract carries; unitCode from the UN/CEFACT map, the
// raw unit kept as unitText when unmapped.
function adaptWeight(
  weight: number | undefined, unit: string | undefined,
): Record<string, unknown> {
  if (weight == null) return {};
  const qv: Record<string, unknown> = {
    '@type': 'QuantitativeValue', value: weight,
  };
  const code = unit ? WEIGHT_UNIT_CODE[unit] : undefined;
  if (code) qv.unitCode = code;
  else if (unit) qv.unitText = unit;
  return { weight: qv };
}

function buildManufacturer(
  m: Fixture['product']['manufacturer'],
): Record<string, unknown> {
  return {
    '@type': 'Organization',
    name: m.name,
    street: m.street,
    city: m.city,
    countryCode: toCountryCode(m.country),
  };
}

// Manufacturer country name -> ISO 3166-1 alpha-2. A
// 2-letter code passes through; an unmapped full name
// fails the seed loudly rather than emitting a non-ISO
// countryCode.
function toCountryCode(country: string): string {
  if (/^[A-Z]{2}$/.test(country)) return country;
  const iso = COUNTRY_ISO[country];
  if (!iso) {
    throw new Error(
      `Unknown manufacturer country "${country}"; add it to COUNTRY_ISO.`,
    );
  }
  return iso;
}

// Apply this version's diff to the product: description
// + images override the base's defaults. Composition
// entries land on the properties array (see
// buildProperties), not here.
function applyVersionDiff(
  base: Record<string, unknown>,
  s: FixtureSnapshot,
  images: ImageMap,
): Record<string, unknown> {
  const versionImages: ImageVariants[] = s.images.map(
    (key: string) => {
      const img = images[key];
      if (!img) {
        throw new Error(
          `Snapshot v${s.version}: unknown image key '${key}'. `
          + `Add it to the top-level images: map.`,
        );
      }
      return { thumbnail: img.thumbnail, large: img.large };
    },
  );

  return {
    ...base,
    ...(s.description ? { description: toWireLocalized(s.description) } : {}),
    images: versionImages,
  };
}

// Flatten the YAML's metrics / lists / accordions /
// compositions blocks into a single PropertyValue[]
// array. Order matches the YAML so a fixture author
// retains control over which tile / badge / accordion /
// donut appears first. The first composition's entries
// are overridden by the version's `composition:` diff;
// the rest pass through unchanged.
function buildProperties(
  fixture: Fixture,
  s: FixtureSnapshot,
): ReadonlyArray<Record<string, unknown>> {
  const p = fixture.product;
  return [
    ...p.metrics.map((m) => propertyRow(m.key, m.label, m.value, m.unit)),
    ...p.lists.map((l) => propertyRow(l.key, l.label, l.values)),
    ...p.accordions.map((a) => propertyRow(a.key, a.label, a.body)),

    // First composition takes the version diff; the rest
    // pass through verbatim. Each substance carries its
    // percent as `value`; the property unit is the donut's.
    ...p.compositions.map((block, i) => propertyRow(
      block.key, block.title,
      toSubstances(
        i === 0
          ? enrichVersionEntries(baseEntriesOf(block), s.composition)
          : baseEntriesOf(block),
      ),
      block.unit,
    )),
  ];
}

// Collect every row's decorative icon into a publisher-side
// key->icon table, keyed by the same `propertyID` the rows
// carry. The snapshot ships no icon; this table is served
// beside the sprite and the SPA joins on it (see
// src/icons.ts `iconForProperty`). Authored per fixture, so
// two publishers can map the same key to different glyphs.
function buildIconMap(fixture: Fixture): Record<string, string> {
  const p = fixture.product;
  const out: Record<string, string> = {};
  const add = (key: string, icon: string | undefined): void => {
    if (icon) out[key] = icon;
  };
  p.metrics.forEach((m) => add(m.key, m.icon));
  p.lists.forEach((l) => add(l.key, l.icon));
  p.accordions.forEach((a) => add(a.key, a.icon));
  p.compositions.forEach((b) => add(b.key, b.icon));
  return out;
}

// A `{ locale: text }` hash: a plain object whose values
// are all strings. The property label and structural values
// (list arrays, substance arrays) are not converted - only a
// localized scalar value.
function isLocaleHash(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v).every((x) => typeof x === 'string');
}

// Serialize a localized literal in the JSON-LD expanded form
// `[{ '@value', '@language' }, ...]` the wire uses under EN
// 18223 (product / property / substance names and values),
// locale-sorted. Strings, numbers, and structural arrays
// pass through; only a locale hash is converted.
function toWireLocalized(v: unknown): unknown {
  if (!isLocaleHash(v)) return v;
  return Object.entries(v)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lang, text]) => ({ '@value': text, '@language': lang }));
}

function propertyRow(
  key: string,
  name: unknown,
  value: unknown,
  unitText?: string,
): Record<string, unknown> {
  return {
    '@type': 'PropertyValue',
    propertyID: key,
    name: toWireLocalized(name),
    value: toWireLocalized(value),
    ...(unitText ? { unitText } : {}),
  };
}

// Map composition entries to the wire substance shape: the
// percent becomes `value` with the UN/CEFACT percent code,
// and segment colour is dropped (presentation, not data).
function toSubstances(
  entries: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown>[] {
  return entries.map((e) => ({
    '@type': 'Substance',
    name: toWireLocalized(e.name),
    value: e.percent,
    unitCode: 'P1',
    ...(e.countryCode ? { countryCode: e.countryCode } : {}),
    ...(e.rating ? { rating: e.rating } : {}),
    ...(e.libraryRef ? { libraryRef: e.libraryRef } : {}),
  }));
}

function baseEntriesOf(
  block: Fixture['product']['compositions'][number],
): Record<string, unknown>[] {
  return block.entries.map((c) => ({
    name: c.name,
    percent: c.percent,
    ...(c.country_code ? { countryCode: c.country_code } : {}),
    ...(c.library_ref ? { libraryRef: c.library_ref } : {}),
    ...(c.rating ? { rating: c.rating } : {}),
  }));
}

function nameKeyOf(name: unknown): string {
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object') {
    const r = name as Record<string, string>;
    return r.en ?? Object.values(r)[0] ?? '';
  }
  return '';
}

type CompositionEntry = FixtureSnapshot['composition'][number];

function enrichVersionEntries(
  baseEntries: ReadonlyArray<Record<string, unknown>>,
  versionEntries: FixtureSnapshot['composition'],
): Record<string, unknown>[] {
  return versionEntries.map((v: CompositionEntry) => {
    const vk = nameKeyOf(v.name);
    const base = baseEntries.find((b) => nameKeyOf(b.name) === vk);
    const versionLibraryRef = v.library_ref ?? base?.libraryRef;
    const versionRating = v.rating ?? base?.rating;
    return base
      ? {
          name: base.name,
          percent: v.percent,
          ...(v.country_code ? { countryCode: v.country_code } : {}),
          ...(versionLibraryRef ? { libraryRef: versionLibraryRef } : {}),
          ...(versionRating ? { rating: versionRating } : {}),
        }
      : {
          name: v.name,
          percent: v.percent,
          ...(v.country_code ? { countryCode: v.country_code } : {}),
          ...(versionLibraryRef ? { libraryRef: versionLibraryRef } : {}),
          ...(versionRating ? { rating: versionRating } : {}),
        };
  });
}

// ─── Manifest ───────────────────────────────────────

function buildManifest(
  fixture: Fixture,
  snapshots: ReadonlyArray<SnapshotOut>,
  signer: SnapshotSigner,
): Record<string, unknown> {
  const versions = snapshots.map((s) => {
    const serialised = JSON.stringify(s);
    return {
      number: s.version,
      publishedAt: s.publishedAt,
      reason: 'fixture',
      hashValue: snapshotHashOf(s),
      url: `v/${s.version}.json`,
      sizeBytes: serialised.length,
    };
  });
  const current = versions[versions.length - 1];

  // The body is everything the manifest signature covers;
  // signManifest hashes it (minus the signature it returns)
  // with the platform key, mirroring the backend's
  // sign_manifest so the SPA verifies the version list.
  const body = {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://transpareo.com/contexts/dpp/v1',
    ],
    '@type': 'DppManifest',
    code: fixture.code,
    issuer: buildIssuer(fixture),
    platform: buildPlatform(fixture),
    availableLocales: fixture.available_locales,
    currentVersion: current.number,
    versions,
    epcisUrl: 'epcis.json',
    signedAt: current.publishedAt,
  };
  return { ...body, signature: signer.signManifest(body) };
}

function snapshotHashOf(s: SnapshotOut): string {
  const { proof: _proof, ...body } = s;
  return createHash('sha256')
    .update(canonicalize(body), 'utf8')
    .digest('hex');
}

// ─── EPCIS (the public events sidecar) ──────────────
//
// Production emits this as the only events feed; the
// renderer-specific fields ride along as `transpareo:*`
// extensions on each ObjectEvent. In production the
// public artefact is PII-clean: actorLabel and
// description are omitted, the renderer-specific fields
// that ride the EPCIS event are limited to eventType,
// versionNumber, statusFrom/To (the non-PII fields
// agreed under decision γ). The fixtures emit the same
// shape so dev mirrors production exactly; the SPA's
// timeline already degrades gracefully when actorLabel
// or description are absent.
//
// An authority-tool embed (not yet implemented) will
// overlay actorLabel + description from an
// authenticated `/api/authority/...` fetch when the
// renderer runs in that mode.

function buildEpcis(
  fixture: Fixture, signer: SnapshotSigner,
): Record<string, unknown> {
  const context: string[] = [
    'https://ref.openepcis.io/extensions/common/core/dpp-core-context.jsonld',
  ];
  if (fixture.regulation) {
    context.push(
      `https://ref.openepcis.io/extensions/eu/${fixture.regulation}`
      + `/${fixture.regulation}-context.jsonld`,
    );
  }
  context.push('https://transpareo.com/vocab/transpareo/v1');

  const eventsById = new Map(
    fixture.events.map((e) => [e.id, e]),
  );

  // The body the document signature covers: the whole EPCIS
  // file minus its (about-to-be-added) `signature`. The
  // publishing side signs the events sidecar with the same
  // platform-key single-signature scheme as the manifest, so
  // the seed reuses signManifest and the SPA verifies it with
  // verifyManifestSignature. Per-event proofs (a publisher
  // convenience for single-event pulls) are out of scope: the
  // renderer reads the whole document and the SPA does not
  // re-check them, so the fixtures carry the document-level
  // signature only.
  const body = {
    '@context': context,
    type: 'EPCISDocument',
    schemaVersion: '2.0',
    creationDate: fixture.published_at,
    epcisBody: {
      eventList: fixture.epcis
        .filter((e) => !eventsById.get(e.dpp_event_id)?.private)
        .map((e) => {
          const rendererEvent = eventsById.get(e.dpp_event_id);
          return {
            type: e.type,
            eventID: e.event_id,
            eventTime: e.event_time,
            eventTimeZoneOffset: e.event_time_zone_offset,
            recordTime: e.record_time,
            action: e.action,
            ...(e.biz_step ? { bizStep: e.biz_step } : {}),
            ...(e.disposition ? { disposition: e.disposition } : {}),
            epcList: e.epc_list,
            readPoint: e.read_point,
            bizLocation: e.biz_location,
            ...(e.extensions ?? {}),
            'transpareo:dppEventId': e.dpp_event_id,
            ...transpareoExtensionsFor(rendererEvent),
          };
        }),
    },
  };
  return { ...body, signature: signer.signManifest(body) };
}

// Build the `transpareo:*` extensions the SPA reads off
// each ObjectEvent. Mirrors the backend's
// `EpcisProjection` shape exactly: eventType,
// versionNumber, statusFrom/To are emitted in
// production (decision γ); actorLabel and description
// are PII and stay behind the authority-tool fetch, so
// the fixtures omit them too.
function transpareoExtensionsFor(
  rendererEvent: Fixture['events'][number] | undefined,
): Record<string, unknown> {
  if (!rendererEvent) return {};
  const out: Record<string, unknown> = {
    'transpareo:eventType': rendererEvent.event_type,
  };
  if (rendererEvent.version != null) {
    out['transpareo:versionNumber'] = rendererEvent.version;
  }
  if (rendererEvent.status_from) {
    out['transpareo:statusFrom'] = rendererEvent.status_from;
  }
  if (rendererEvent.status_to) {
    out['transpareo:statusTo'] = rendererEvent.status_to;
  }
  return out;
}
