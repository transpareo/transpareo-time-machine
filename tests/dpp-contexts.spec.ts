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
  DPP_CONTEXTS, TRANSPAREO_CONTEXT_URL, VC_CONTEXT_URL,
} from '../src/crypto/dpp-contexts'

const TRANSPAREO = 'https://transpareo.com/vocab/transpareo/v1#'
const XSD = 'http://www.w3.org/2001/XMLSchema#'

describe('the bundled Transpareo context', () => {
  // A property row whose value is a reading at publish; the
  // live value is in the dynamic-data document.
  it('expands the dynamic marker to the publisher IRI', async () => {
    const doc = {
      '@context': [VC_CONTEXT_URL, TRANSPAREO_CONTEXT_URL],
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
      '@context': [VC_CONTEXT_URL, TRANSPAREO_CONTEXT_URL],
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
})
