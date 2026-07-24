/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The JSON-LD contexts a DPP Verifiable Credential
 * references by URL, cached for offline canonicalization.
 * ecdsa-sd verification canonicalizes to RDF (RDFC-1.0),
 * which needs every `@context` resolved; the archive must
 * verify with no network, so the two versioned contexts
 * are bundled here rather than fetched. They mirror the
 * hosted context documents; if the vocabulary gains terms
 * in v1, this copy is updated in lockstep.
 */

import vcV1 from '../contexts/vc-v1.json'
import transpareoV1 from '../contexts/transpareo-v1.json'

export const VC_CONTEXT_URL = 'https://transpareo.com/vocab/vc/v1'
export const TRANSPAREO_CONTEXT_URL =
  'https://transpareo.com/vocab/transpareo/v1'

// URL -> context document, passed to the canonicalizer so a
// `@context` URL entry resolves to its local term map.
export const DPP_CONTEXTS: Readonly<Record<string, unknown>> = {
  [VC_CONTEXT_URL]: vcV1,
  [TRANSPAREO_CONTEXT_URL]: transpareoV1,
}
