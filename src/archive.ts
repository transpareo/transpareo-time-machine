/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Per-DPP signed manifest. Emitted by the backend's
// `ManifestPublisher` and the only artefact the SPA
// needs to know about at boot time: it names every
// other artefact (each version's snapshot at
// `versions[].url`, the EPCIS events sidecar at
// `epcisUrl`) so the renderer doesn't have to assume
// any specific path layout in the issuer's bucket.
//
// Issuer + platform are JSON-LD Organization blocks
// carried on the manifest so a catalogue or verifier
// widget can render attribution before any snapshot
// fetch. Both are part of the signed body and cannot
// be tampered with after publishing.
export interface ManifestVersion {
  readonly number: number

  // When the issuer flipped this version live. Timeline
  // dots anchor on this.
  readonly publishedAt: string | null

  // Optional registry round-trip timestamp; may stay
  // null indefinitely (registry API not live yet, or
  // publisher opted out). Surfaced in the verification
  // modal when present, never used for scrubbing.
  readonly registeredAt?: string | null
  readonly reason: string
  readonly hashValue: string
  readonly hashAlgorithm?: string
  readonly hashCanonicalForm?: string
  readonly url: string
  readonly sizeBytes: number
  readonly registrationProof?: string

  // Publisher-hosted endpoint that returns the category-3
  // (private) property rows the current user is
  // authorised to read for this version. Emitted by the
  // backend's ManifestPublisher when the version has at
  // least one private row and the publisher is active;
  // absent on versions without private rows and on every
  // version after the publisher has been cancelled. The SPA
  // fetches the URL unconditionally when present and
  // branches on the response status (200 merges rows,
  // 204 means authenticated-but-no-access, 401 surfaces
  // a login button). The nested-object shape leaves
  // room for additional metadata fields later without a
  // manifest-schema migration.
  readonly privateProperties?: {
    readonly url: string
  }
}

export interface ManifestSignature {
  readonly type: string
  readonly cryptosuite: string
  readonly created: string
  readonly verificationMethod: string
  readonly proofPurpose: string
  readonly proofValue: string
}

export interface DppManifest {
  readonly '@context'?: ReadonlyArray<string>
  readonly '@type': 'DppManifest'
  readonly code: string
  readonly issuer: Organization
  readonly platform: Organization

  // Locale codes available for this DPP. Drives the
  // footer's language picker. DPP-level concern, not
  // an issuer-wide one (different DPPs from the same
  // issuer may localise differently).
  readonly availableLocales: ReadonlyArray<string>
  readonly currentVersion: number
  readonly versions: ReadonlyArray<ManifestVersion>

  // CDN URL of the gzipped EPCIS document carrying the
  // public events feed for this DPP. The SPA derives
  // its timeline from this single artefact; no separate
  // events sidecar is published.
  readonly epcisUrl: string
  readonly signedAt: string
  readonly signature: ManifestSignature
}

// schema.org-style Organization block, used wherever
// the manifest or a snapshot names a party (issuer,
// platform). `did` is the Decentralized Identifier
// for the entity (e.g. did:web:transpareo.com). The
// durable platform fallback is the apex path form
// `transpareo.com/dpp/{handle}/{code}`, NOT the
// `{handle}.transpareo.com` subdomain: that subdomain is
// torn down when a publisher is cancelled, while the apex
// domain survives so historical DPPs stay resolvable.
// Reading `issuer.did` / `platform.did` literally is the
// only correct way to match the chip identity against the
// proof blocks.
export interface Organization {
  readonly '@type': 'Organization'
  readonly name: string
  readonly did: string
}

// A signed JSON-LD snapshot blob. The serializer is
// minimal on purpose, the trust payload is identity +
// version + the embedded eddsa-jcs-2022 proofs. Rendered
// product data lives in the SPA's own data layer.
//
// `proof` is a JSON-LD proof set of independent Data
// Integrity proofs. The snapshot is signed by two
// authorities, the issuer and the platform; each signs
// several entries with different `verificationMethod` URLs
// (HTTPS host, HTTPS CDN, did:web) that resolve to its one
// key, so a verifier can reach the key by whichever URL it
// can. A snapshot counts as authentic when at least one
// issuer entry AND at least one platform entry verifies
// (2-of-2 across the authority pair).
export interface SignedSnapshot {
  readonly '@context'?:
    | string
    | ReadonlyArray<string | Record<string, unknown>>
  readonly '@type'?: string
  readonly code?: string
  readonly version: number
  readonly publishedAt: string
  readonly gtin?: string
  readonly proof?: ReadonlyArray<ManifestSignature>
  readonly [key: string]: unknown
}

// Per-version verification state. Versions verify
// lazily: the active version on first paint, others as
// the user scrubs to them. Once `verifySnapshot`
// resolves the state moves to verified or failed; the
// full `VerificationResult` is carried on both branches
// so the proof modal can render the per-entry chain
// regardless of the aggregate outcome.
//
// `chain` is the content-continuity check
// (priorVersionHash vs manifest.versions[N-1].hashValue),
// independent of the per-snapshot signature. A version
// is verified only when both pass.
export type VersionState =
  | { status: 'pending' }
  | {
      status: 'verified'
      result: VerificationResult
      chain: ChainStatusResult
    }
  | {
      status: 'failed'
      result: VerificationResult
      chain: ChainStatusResult
      reason: string
    }

// Re-export so callers can grab the result types from
// the archive layer without reaching into src/crypto/
// or src/actions.
export type { VerificationResult } from '@/crypto/verify'
export type { ChainStatusResult } from '@/actions'
import type { VerificationResult } from '@/crypto/verify'
import type { ChainStatusResult } from '@/actions'
