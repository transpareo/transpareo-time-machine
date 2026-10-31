/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The W3C credentials context defines the envelope and the
 * Data Integrity proof terms inside the @context of a type or
 * a property. Expected N-Quads are hand-derived from the VC
 * data model and Data Integrity specifications.
 */

import { describe, expect, it } from 'vitest'
import { canonicalize } from '../src/crypto/rdfc'
import { DPP_CONTEXTS } from '../src/crypto/dpp-contexts'

const CONTEXT = [
  'https://www.w3.org/ns/credentials/v2',
  'https://transpareo.com/vocab/vc/v2',
  'https://transpareo.com/vocab/transpareo/v2'
]
const CRED = 'https://www.w3.org/2018/credentials#'
const SEC = 'https://w3id.org/security#'
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const options = { contexts: DPP_CONTEXTS }

describe('canonicalize: type-scoped contexts', () => {
  it('reads the envelope under the VerifiableCredential context', async () => {
    const doc = {
      '@context': CONTEXT,
      '@id': 'https://x.test/p#credential',
      type: 'VerifiableCredential',
      issuer: 'did:web:x.test',
      credentialSubject: { '@id': 'https://x.test/p', name: 'Hans' }
    }
    const quads = await canonicalize(doc, options)
    const envelope = '<https://x.test/p#credential>'
    expect(quads).toContain(
      `${envelope} <${CRED}issuer> <did:web:x.test> .\n`
    )
    expect(quads).toContain(
      `${envelope} <${CRED}credentialSubject> <https://x.test/p> .\n`
    )
    expect(quads).toContain(
      '<https://x.test/p> <https://schema.org/name> "Hans" .\n'
    )
  })

  // The subject is a node inside the envelope, so the
  // envelope's own terms stop at its boundary.
  it('keeps the envelope terms out of the subject', async () => {
    const doc = {
      '@context': CONTEXT,
      '@id': 'https://x.test/p#credential',
      type: 'VerifiableCredential',
      credentialSubject: {
        '@id': 'https://x.test/p',
        issuer: { '@id': 'https://x.test/p#issuer', name: 'Org' }
      }
    }
    const quads = await canonicalize(doc, options)
    expect(quads).toContain(
      '<https://x.test/p> <https://transpareo.com/vocab/vc/v1#issuer> '
        + '<https://x.test/p#issuer> .\n'
    )
  })

  it('reads a proof configuration under the Data Integrity terms', async () => {
    const proof = {
      '@context': CONTEXT,
      type: 'DataIntegrityProof',
      cryptosuite: 'ecdsa-sd-2023',
      created: '2026-10-30T10:00:00Z',
      verificationMethod: 'did:web:x.test#key-1',
      proofPurpose: 'assertionMethod'
    }
    const quads = await canonicalize(proof, options)
    expect(quads).toEqual([
      '_:c14n0 <http://purl.org/dc/terms/created> '
        + `"2026-10-30T10:00:00Z"^^<${XSD}dateTime> .\n`,
      `_:c14n0 <${RDF_TYPE}> <${SEC}DataIntegrityProof> .\n`,
      `_:c14n0 <${SEC}cryptosuite> "ecdsa-sd-2023"`
        + `^^<${SEC}cryptosuiteString> .\n`,
      `_:c14n0 <${SEC}proofPurpose> <${SEC}assertionMethod> .\n`,
      `_:c14n0 <${SEC}verificationMethod> <did:web:x.test#key-1> .\n`
    ])
  })

  it('rejects a property-scoped context on a node', async () => {
    const doc = {
      '@context': CONTEXT,
      '@id': 'https://x.test/p',
      cnf: { '@id': 'https://x.test/p#key' }
    }
    await expect(canonicalize(doc, options))
      .rejects.toThrow(/property-scoped/)
  })
})
