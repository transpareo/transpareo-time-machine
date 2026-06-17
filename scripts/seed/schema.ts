/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * YAML schema for `fixtures/*.yml`. Mirrors the runtime
 * types declared in `src/types.ts` + `src/archive.ts` so
 * the codegen can emit TS that imports those types
 * directly. The schema is enforced by zod; any deviation
 * aborts the generator with a precise "at `...`:" path.
 */

import { z } from 'zod';

// Translatable string, single literal for one-locale
// or a record keyed by locale code. Mirrors
// `LocalizedText` in src/types.ts.
const LocalizedText = z.union([
  z.string(),
  z.record(z.string(), z.string()),
]);

const Iso8601 = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
  { message: 'must be an ISO 8601 UTC timestamp (e.g. 2024-01-15T10:00:00Z)' },
);

// Fixture image declaration: two source URLs the seed
// downloads, one per render variant. The snapshot wire
// shape uses the same `{ thumbnail, large }` keys; the
// seed copies the downloaded bytes into the public tree
// and rewrites both keys to the served paths.
const ImageSrc = z.object({
  thumbnail: z.url(),
  large: z.url(),
});

const LifecycleStatus = z.enum([
  'draft', 'placed_on_market', 'in_use', 'repair',
  'refurbished', 'collected', 'recycled', 'end_of_life',
  'suspended',
]);

const EventType = z.enum([
  'published', 'lifecycle_transition', 'recalled',
  'rolled_back', 'registered_with_eu', 'repair',
  'refurbished', 'collected', 'recycled', 'inspection',
]);

const Rating = z.enum([
  'veryBad', 'bad', 'neutral', 'good', 'veryGood',
]);

const CompositionEntry = z.object({
  name: LocalizedText,
  percent: z.number().nonnegative(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  country_code: z.string().length(2).optional(),
  // Optional reference to a versioned library object on
  // the public bucket, e.g. `component/organic-cotton/v3.json`.
  // The renderer resolves it against the manifest URL and
  // opens the result in the library modal on click.
  library_ref: z.string().optional(),
  // Optional five-step sustainability rating. Drives the
  // row chip and the library modal lead.
  rating: Rating.optional(),
});

const DppMetric = z.object({
  key: z.string(),
  label: LocalizedText,
  // A bare number renders locale-aware (87.3 -> "87,3" in
  // de-DE) with `unit` shown beside it; a string / locale
  // hash passes through verbatim.
  value: z.union([LocalizedText, z.number()]),
  unit: z.string().optional(),
  icon: z.string().optional(),
});

const DppList = z.object({
  key: z.string(),
  label: LocalizedText,
  values: z.array(LocalizedText),
  icon: z.string().optional(),
});

const DppAccordion = z.object({
  key: z.string(),
  label: LocalizedText,
  body: LocalizedText,
  icon: z.string().optional(),
});

const Manufacturer = z.object({
  name: z.string(),
  street: z.string(),
  city: z.string(),
  country: z.string(),
});

// Issuer block (the party publishing the DPP), in the
// W3C JSON-LD shape the production pipeline emits.
// The seeder uses `fixture.id` (already required and
// kebab-case-validated) as the path component when
// laying out the artefacts under /public/<id>/dpp/...;
// no separate handle field is needed.
const Issuer = z.object({
  name: z.string(),
  did: z.string().min(1),
});

// The renderer / archive operator. Defaults are
// hardcoded for the Transpareo deployment; OSS forks
// override per-fixture.
const Platform = z.object({
  name: z.string(),
  did: z.string().min(1),
});

// Named composition block. `unit` (if set) drives the
// per-entry value cell and the donut centre label;
// without it the renderer falls back to "%". The donut
// always normalises against the sum of entries so it
// fills 100% of the ring.
const CompositionBlock = z.object({
  key: z.string(),
  title: LocalizedText,
  icon: z.string().optional(),
  unit: z.string().optional(),
  entries: z.array(CompositionEntry).min(1),
});

const Product = z.object({
  name: LocalizedText,
  brand: z.string(),
  description: LocalizedText,
  category: LocalizedText.optional(),
  gtin: z.string().optional(),
  weight: z.number().positive().optional(),
  weight_unit: z.string().optional(),
  // One or more named composition blocks. The first
  // block is treated as the canonical "material"
  // composition and is the one snapshot diffs are
  // applied to.
  compositions: z.array(CompositionBlock).min(1),
  metrics: z.array(DppMetric),
  lists: z.array(DppList),
  accordions: z.array(DppAccordion),
  manufacturer: Manufacturer,
  // Optional rolled-up sustainability rating.
  rating: Rating.optional(),
});

const Snapshot = z.object({
  version: z.number().int().positive(),
  published_at: Iso8601,
  status: LifecycleStatus,
  composition: z.array(CompositionEntry),
  description: LocalizedText.optional(),
  // List of image keys declared in the top-level
  // `images:` map. The seeder downloads each key once
  // into `public/fixtures/<id>/<key>.jpg`; snapshots
  // reference them by key.
  images: z.array(z.string()).default([]),
});

const Event = z.object({
  id: z.string(),
  event_type: EventType,
  occurred_at: Iso8601,
  actor_label: z.string(),
  status_from: LifecycleStatus.optional(),
  status_to: LifecycleStatus.optional(),
  description: LocalizedText.optional(),
  // When set, the event triggered a new snapshot,
  // links to a version in the `snapshots:` block.
  version: z.number().int().positive().optional(),
  // Regulator-only events sidecar (default public).
  private: z.boolean().optional(),
});

// EPCIS ObjectEvent, verbatim shape (snake_case in
// YAML, camelCase on emit). The bag-of-extension-
// properties (`transpareo:...`) is preserved as-is.
const EpcisLocation = z.object({
  id: z.url(),
});

const EpcisEvent = z.object({
  dpp_event_id: z.string(),
  type: z.literal('ObjectEvent').default('ObjectEvent'),
  event_id: z.string(),
  event_time: Iso8601,
  event_time_zone_offset: z.string(),
  record_time: Iso8601,
  action: z.enum(['ADD', 'OBSERVE', 'DELETE']),
  biz_step: z.string().optional(),
  disposition: z.string().optional(),
  epc_list: z.array(z.string()).min(1),
  read_point: EpcisLocation,
  biz_location: EpcisLocation,
  extensions: z.record(z.string(), z.unknown()).optional(),
});

// Per-fixture branding assets, CSS body + logo +
// favicons. Each asset declares its source as either
// `url:` (the seeder downloads) or `file:` (the seeder
// copies a path inside the repo). Both land at the
// same `public/fixtures/<id>/branding/<key>.<ext>` so
// the generated TS path the SPA serves is identical.
const AssetSource = z.union([
  z.object({ url: z.url() }),
  z.object({ file: z.string() }),
]);

const BrandingIcon = z.intersection(
  z.object({ size: z.number().int().positive() }),
  AssetSource,
);

const Branding = z.object({
  // Either inline CSS (preferred for the demo seed,
  // committed to the repo) or a remote URL the seeder
  // downloads. The string-vs-object discriminator is
  // resolved by the codegen.
  css: z.union([
    z.string(),
    z.object({ url: z.url() }),
    z.object({ file: z.string() }),
  ]),
  logo: z.intersection(
    z.object({ width: z.number().positive().optional() }),
    AssetSource,
  ).optional(),
  favicon: AssetSource.optional(),
  icons: z.array(BrandingIcon).optional(),
});

// Regulation-specific OpenEPCIS extension to chain into
// the EPCIS document `@context` (after dpp-core, before
// transpareo). The codegen picks the matching
// `ref.openepcis.io/extensions/eu/<name>/<name>-context.jsonld`
// URL so downstream tooling resolves the right terms:
// `battery:` exposes `PortableBattery`, `PrismaticCell`,
// `CFClassB`, `lithiumRecycledShare`; `textile:` exposes
// its own vocabulary; and so on.
const Regulation = z.enum([
  'battery', 'textile', 'electronics', 'eudr',
  'detergent', 'ppwr', 'cpr',
]);

// Top-level fixture document.
export const FixtureSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+$/, {
    message: 'id must be kebab-case (a-z, 0-9, -)',
  }),
  // Interpolated into filesystem paths (public/<id>/dpp/<code>/
  // and the keys/ dir), so constrain it to a safe charset:
  // no path separators and no `.` means `..` can't escape.
  code: z.string().regex(/^[A-Za-z0-9_-]+$/, {
    message: 'code must be alphanumeric with - or _ (no path separators)',
  }),
  status: LifecycleStatus,
  published_at: Iso8601,
  verified: z.boolean(),
  // Optional. Omit for fixtures that aren't regulated
  // under one of the listed EU schemes. When set, the
  // codegen appends the matching ref.openepcis.io
  // extension context to the EPCIS document.
  regulation: Regulation.optional(),
  issuer: Issuer,
  platform: Platform,
  available_locales: z.array(z.string()).min(1),
  product: Product,
  branding: Branding.optional(),
  // Image-map keys become on-disk filenames, so constrain
  // them to a safe charset (no path separators, no `..`).
  images: z.record(
    z.string().regex(/^[A-Za-z0-9_-]+$/, {
      message: 'image key must be alphanumeric with - or _',
    }),
    ImageSrc,
  ).default({}),
  snapshots: z.array(Snapshot).min(1),
  events: z.array(Event),
  epcis: z.array(EpcisEvent).default([]),
});

export type Fixture = z.infer<typeof FixtureSchema>;
