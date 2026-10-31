/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The JSON-LD contexts a DPP Verifiable Credential
 * references by URL, cached for offline canonicalization.
 * ecdsa-sd verification canonicalizes to RDF (RDFC-1.0),
 * which needs every `@context` resolved; the archive must
 * verify with no network, so the versioned contexts are
 * bundled here rather than fetched. A published edition
 * never changes: a passport keeps naming the edition it was
 * signed under, so every edition stays here, and new terms
 * arrive as a new edition with its own URL.
 *
 * A credential signed before the W3C credentials context led
 * its `@context` names vc/v1 and transpareo/v1; a newer one
 * names the W3C context, vc/v2 and transpareo/v2. The W3C
 * copy is the published document byte for byte.
 */

import credentialsV2 from '../contexts/credentials-v2.json'
import vcV1 from '../contexts/vc-v1.json'
import vcV2 from '../contexts/vc-v2.json'
import transpareoV1 from '../contexts/transpareo-v1.json'
import transpareoV2Terms from '../contexts/transpareo-v2-terms.json'

export const CREDENTIALS_CONTEXT_URL = 'https://www.w3.org/ns/credentials/v2'
export const VC_CONTEXT_URL = 'https://transpareo.com/vocab/vc/v1'
export const VC_V2_CONTEXT_URL = 'https://transpareo.com/vocab/vc/v2'
export const TRANSPAREO_V1_CONTEXT_URL =
  'https://transpareo.com/vocab/transpareo/v1'
export const TRANSPAREO_V2_CONTEXT_URL =
  'https://transpareo.com/vocab/transpareo/v2'

// v2 is every v1 term at its v1 IRI plus the terms it adds,
// as the publisher derives it, but `description`: the W3C
// credentials context a v2 credential lists first defines it
// and protects it. Composed from the v1 copy so the bundle
// carries those terms once.
const { description: _description, ...v1Terms } = transpareoV1['@context']
const transpareoV2 = { '@context': { ...v1Terms, ...transpareoV2Terms } }

// URL -> context document, passed to the canonicalizer so a
// `@context` URL entry resolves to its local term map.
export const DPP_CONTEXTS: Readonly<Record<string, unknown>> = {
  [CREDENTIALS_CONTEXT_URL]: credentialsV2,
  [VC_CONTEXT_URL]: vcV1,
  [VC_V2_CONTEXT_URL]: vcV2,
  [TRANSPAREO_V1_CONTEXT_URL]: transpareoV1,
  [TRANSPAREO_V2_CONTEXT_URL]: transpareoV2
}
