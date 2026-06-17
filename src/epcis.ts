/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * EPCIS 2.0 JSON-LD type definitions for the public
 * events file the platform writes to
 *   {publisher_slug}/dpp/{code}/events.jsonld.gz
 *
 * The file is an EPCISDocument carrying ObjectEvents for
 * the publishable subset of DppEvents. Only fields the
 * renderer reads are typed here; arbitrary extension
 * properties are accepted via the index signature on
 * EpcisObjectEvent so OpenEPCIS / EU-Core / transpareo:
 * namespaced fields pass through untyped.
 *
 * Field documentation cross-references EPCIS 2.0
 * (ISO/IEC 19987) and the CBV 2.0 vocabulary. See
 * docs/dpp-platform-architecture.md -> "EPCIS projection".
 */

import type { ManifestSignature } from '@/archive'

export type EpcisAction = 'OBSERVE' | 'ADD' | 'DELETE'

// CBV 2.0 codes are CURIEs like `cbv:BizStep-repairing`
// or `cbv:Disp-in_progress`. Stored as opaque strings
// here; `cbvLabel()` extracts the human-readable name.
export type CbvBizStep = `cbv:BizStep-${string}`
export type CbvDisposition = `cbv:Disp-${string}`

// GLN (Global Location Number) resolved to a GS1 Digital
// Link URI: `https://id.gs1.org/414/<13-digit GLN>`.
export interface EpcisLocation {
  readonly id: string
}

export interface EpcisObjectEvent {
  readonly type: 'ObjectEvent'
  readonly eventID: string
  readonly eventTime: string
  readonly eventTimeZoneOffset: string
  readonly recordTime?: string
  readonly action: EpcisAction
  readonly bizStep?: CbvBizStep
  readonly disposition?: CbvDisposition
  readonly epcList: ReadonlyArray<string>
  readonly readPoint?: EpcisLocation
  readonly bizLocation?: EpcisLocation

  // OpenEPCIS DPP-core + transpareo: extensions are
  // pass-through. Notable keys we read:
  //   transpareo:dppEventId, join key back to DppEvent.id
  //   transpareo:scope     , sub-categorisation of
  //                           coarse bizStep (e.g. repair)
  readonly [extension: string]: unknown
}

export interface EpcisBody {
  readonly eventList: ReadonlyArray<EpcisObjectEvent>
}

export interface EpcisDocument {
  readonly '@context': ReadonlyArray<string | Record<string, unknown>>
  readonly type: 'EPCISDocument'
  readonly schemaVersion: '2.0'
  readonly creationDate: string
  readonly epcisBody: EpcisBody

  // Document-level platform signature over the whole
  // events file: the JCS canonical body (this object with
  // `signature` removed), SHA-256, Ed25519-signed by the
  // Transpareo platform key. Same single-signature scheme
  // as the manifest, so the SPA verifies it with
  // verifyManifestSignature. The backend also signs each
  // ObjectEvent individually (a `proof` array per event)
  // for consumers pulling one event out of the bundle; the
  // renderer reads the whole document, so the document-level
  // signature is the relevant check and the per-event proofs
  // ride along inside the signed body. Absent on older or
  // unsigned feeds, which the verifier tolerates.
  readonly signature?: ManifestSignature
}

// Parse an event timestamp for ordering and positioning.
// A malformed `occurredAt` parses to NaN, which makes a
// sort comparator's result NaN (order then becomes
// implementation-defined) and poisons timeline
// x-positions; pin malformed values to epoch 0 so a broken
// feed renders deterministically (oldest position) instead
// of randomly.
export function eventTime(occurredAt: string): number {
  const t = new Date(occurredAt).getTime()
  return Number.isNaN(t) ? 0 : t
}

// `cbv:BizStep-repairing` -> `repairing`.
// `cbv:Disp-in_progress` -> `in progress`.
// Returns the CBV local term with underscores spaced out,
// in the vocabulary's own lower-case (no title-casing of a
// user-facing value); a stylesheet can capitalize it for
// display. Falls back to the original string when the input
// doesn't match the CBV CURIE shape.
export function cbvLabel(curie: string | undefined): string {
  if (!curie) return ''
  const m = curie.match(/^cbv:(?:BizStep|Disp|BTT|SDT|ER|Comp)-(.+)$/)
  if (!m) return curie
  return m[1].replace(/_/g, ' ')
}

// `https://id.gs1.org/414/5012345100111` -> `5012345100111`.
// Returns the original URI when it isn't in GS1 Digital
// Link 414 form.
export function glnFromUri(uri: string | undefined): string {
  if (!uri) return ''
  const m = uri.match(/\/414\/(\d{13})(?:$|[/?])/)
  return m ? m[1] : uri
}

// Pull the trailing identifier off a GS1 Digital Link
// for compact display. Keeps the full URI when no
// `/10/<lot>/21/<serial>` or `/00/<sscc>` is present.
export function epcShortLabel(uri: string): string {
  const sn = uri.match(/\/21\/([^/?]+)/)
  if (sn) return sn[1]
  const lot = uri.match(/\/10\/([^/?]+)/)
  if (lot) return lot[1]
  const sscc = uri.match(/\/00\/([^/?]+)/)
  if (sscc) return sscc[1]
  return uri
}
