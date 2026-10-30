/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The bundled copies of the contexts a DPP credential
 * references. An ecdsa-sd proof signs the RDF statements,
 * so a term this copy leaves undefined expands through the
 * VC context's @vocab to another IRI than the one the
 * publisher signed, and every proof over it fails. The seed
 * signs with this same copy, so only a spec that names the
 * publisher's IRI catches a term the copy is missing.
 */

import { describe, expect, it } from 'vitest'
import { canonicalize } from '../src/crypto/rdfc'
import {
  DPP_CONTEXTS, TRANSPAREO_V1_CONTEXT_URL, TRANSPAREO_V2_CONTEXT_URL,
  VC_CONTEXT_URL,
} from '../src/crypto/dpp-contexts'
import { REGION_DATATYPE } from '../src/types'
import hostedV2 from './fixtures/transpareo-v2-context.json'

const TRANSPAREO = 'https://transpareo.com/vocab/transpareo/v1#'
const TRANSPAREO_V2 = 'https://transpareo.com/vocab/transpareo/v2#'
const DOCUMENT_TYPE = `${TRANSPAREO_V2}document-type`
const XSD = 'http://www.w3.org/2001/XMLSchema#'

describe('the bundled Transpareo v1 context', () => {
  // A property row whose value is a reading at publish; the
  // live value is in the dynamic-data document.
  it('expands the dynamic marker to the publisher IRI', async () => {
    const doc = {
      '@context': [VC_CONTEXT_URL, TRANSPAREO_V1_CONTEXT_URL],
      '@id': 'https://publisher.test/dpp/a#row',
      dynamic: true,
    }
    const quads = await canonicalize(doc, { contexts: DPP_CONTEXTS })

    expect(quads).toContain(
      '<https://publisher.test/dpp/a#row> '
        + `<${TRANSPAREO}dynamic> "true"^^<${XSD}boolean> .\n`,
    )
  })

  // The passport levels: what a passport covers, which
  // level its unit passports sit at, and how to find one.
  it.each([
    ['passportLevel', '"model"', 'string'],
    ['unitPassportLevel', '"item"', 'string'],
    ['unitPassportLookup', '"https://x.test/21/{serial}"', 'string'],
    ['lotManufacturedOn', '"2026-03-01"', 'date'],
  ])('expands %s to the publisher IRI', async (term, value, type) => {
    const doc = {
      '@context': [VC_CONTEXT_URL, TRANSPAREO_V1_CONTEXT_URL],
      '@id': 'https://publisher.test/dpp/a',
      [term]: JSON.parse(value),
    }
    const quads = await canonicalize(doc, { contexts: DPP_CONTEXTS })
    const object = type === 'string'
      ? value : `${value}^^<${XSD}${type}>`

    expect(quads).toContain(
      `<https://publisher.test/dpp/a> <${TRANSPAREO}${term}> ${object} .\n`,
    )
  })

  // The CN code is a Transpareo term. The HS code is defined
  // in neither context, and every credential issued so far
  // signed it through the VC context's @vocab.
  it('expands the customs codes to the IRIs the publisher signs', async () => {
    const doc = {
      '@context': [VC_CONTEXT_URL, TRANSPAREO_V1_CONTEXT_URL],
      '@id': 'https://publisher.test/dpp/a',
      hsCode: '610910',
      cnCode: '61091000',
    }
    const quads = await canonicalize(doc, { contexts: DPP_CONTEXTS })

    expect(quads).toContain(
      `<https://publisher.test/dpp/a> <${TRANSPAREO}cnCode> "61091000" .\n`,
    )
    expect(quads).toContain(
      `<https://publisher.test/dpp/a> <${VC_CONTEXT_URL}#hsCode> "610910" .\n`,
    )
  })
})

describe('the bundled Transpareo v2 context', () => {
  // The fixture is the document the publisher serves at the
  // v2 URL, copied as is. The bundle composes it from the v1
  // copy and the entries v2 adds, so the v1 terms ship once.
  it('equals the hosted v2 document', () => {
    expect(DPP_CONTEXTS[TRANSPAREO_V2_CONTEXT_URL]).toEqual(hostedV2)
  })

  // v2 keeps every v1 term at its v1 IRI, so a passport says
  // the same under either edition.
  it('expands the v1 terms as the v1 context does', async () => {
    const body = {
      '@id': 'https://publisher.test/dpp/a',
      dynamic: true,
      passportLevel: 'model',
      lotManufacturedOn: '2026-03-01',
      carbonFootprint: '4.2',
      cnCode: '61091000',
      originCountry: { '@value': 'PT', '@type': REGION_DATATYPE },
      hsCode: '610910'
    }
    const contexts = { contexts: DPP_CONTEXTS }
    const v1 = await canonicalize(
      { '@context': [VC_CONTEXT_URL, TRANSPAREO_V1_CONTEXT_URL], ...body },
      contexts
    )
    const v2 = await canonicalize(
      { '@context': [VC_CONTEXT_URL, TRANSPAREO_V2_CONTEXT_URL], ...body },
      contexts
    )

    expect(v2).toEqual(v1)
    expect(v2.join('')).toContain(`<${TRANSPAREO}carbonFootprint>`)
  })

  // A download as the publisher signs it: one Link per file,
  // its language versions inside.
  const link = 'https://publisher.test/dpp/a#downloads/0'
  const doc = {
    '@context': [VC_CONTEXT_URL, TRANSPAREO_V2_CONTEXT_URL],
    '@id': 'https://publisher.test/dpp/a',
    downloads: [{
      '@id': link,
      '@type': 'Link',
      fileDigest: 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
      fileLanguages: ['de'],
      documentType: { '@value': 'test_report', '@type': DOCUMENT_TYPE },
      documentIssuer: 'Hohenstein Institute',
      documentNumber: 'HS-2026-0412',
      documentValidFrom: '2026-01-01',
      documentValidUntil: '2028-12-31',
      fileVersions: [{ '@id': `${link}/en` }]
    }]
  }

  it.each([
    ['downloads', '<https://publisher.test/dpp/a>', `<${link}>`],
    ['fileDigest', `<${link}>`,
      '"sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="'],
    ['fileLanguages', `<${link}>`, `"de"^^<${XSD}language>`],
    ['documentType', `<${link}>`, `"test_report"^^<${DOCUMENT_TYPE}>`],
    ['documentIssuer', `<${link}>`, '"Hohenstein Institute"'],
    ['documentNumber', `<${link}>`, '"HS-2026-0412"'],
    ['documentValidFrom', `<${link}>`, `"2026-01-01"^^<${XSD}date>`],
    ['documentValidUntil', `<${link}>`, `"2028-12-31"^^<${XSD}date>`],
    ['fileVersions', `<${link}>`, `<${link}/en>`]
  ])('expands %s to the v2 IRI', async (term, subject, object) => {
    const quads = await canonicalize(doc, { contexts: DPP_CONTEXTS })

    expect(quads).toContain(`${subject} <${TRANSPAREO_V2}${term}> ${object} .\n`)
  })

  // The country code list is a v1 datatype the renderer
  // resolves names through; the document type is new in v2.
  it('defines the datatypes the passport types its codes with', () => {
    const v2 = DPP_CONTEXTS[TRANSPAREO_V2_CONTEXT_URL] as {
      '@context': Record<string, { '@id': string }>
    }

    expect(v2['@context']['iso3166-1-alpha2']['@id']).toBe(REGION_DATATYPE)
    expect(v2['@context']['document-type']['@id']).toBe(DOCUMENT_TYPE)
  })
})
