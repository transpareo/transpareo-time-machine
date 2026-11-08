/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A statement the JSON asserts more than once. RDF holds a
 * set, and so does the issuer's graph: a repeated value or
 * type, one @id written in two places and one literal written
 * two ways are one statement there, hashed and signed once.
 * Each is read once here, for the lines and for the hashes
 * that label blank nodes.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { canonicalize } from '../src/crypto/rdfc'
import { DPP_CONTEXTS } from '../src/crypto/dpp-contexts'
import {
  parseDerivedProofValue, verifyDerivedProof
} from '../src/crypto/ecdsa-sd'
import { hexChainHashOfSnapshot } from '../src/crypto/verify'
import type { ProofCarrier } from '../src/crypto/verify'
import { encodeDerivedProofValue } from './helpers/sd-signer'

const EX = 'http://example.org/'
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const CTX = {
  ex: EX, xsd: XSD, type: '@type', v: 'ex:v', w: 'ex:w', knows: 'ex:knows'
}
const node = (entries: object) =>
  ({ '@context': CTX, '@id': 'ex:s', ...entries })
const tagged = (language: string) => ({ '@value': 'x', '@language': language })
const quad = (p: string, object: string) => `<${EX}s> <${p}> ${object} .\n`
const typed = quad(RDF_TYPE, `<${EX}A>`)
const valued = (object: string) => quad(`${EX}v`, object)

describe('canonicalize: a statement asserted twice', () => {
  it.each([
    ['a type', { '@type': ['ex:A', 'ex:A'] }, [typed]],
    ['a type through its alias as well', { type: 'ex:A', '@type': 'ex:A' },
      [typed]],
    ['a value', { v: ['x', 'x'] }, [valued('"x"')]],
    ['an integer written two ways',
      { v: [5, { '@value': '5', '@type': 'xsd:integer' }] },
      [valued(`"5"^^<${XSD}integer>`)]],
    ['a string written two ways',
      { v: ['x', { '@value': 'x', '@type': 'xsd:string' }] }, [valued('"x"')]],
    ['a tag written in two cases', { v: [tagged('EN'), tagged('en')] },
      [valued('"x"@en')]],
    ['a node written twice', {
      knows: [{ '@id': 'ex:o', v: 'x' }, { '@id': 'ex:o', v: 'x' }]
    }, [`<${EX}o> <${EX}v> "x" .\n`, quad(`${EX}knows`, `<${EX}o>`)]]
  ])('reads %s once', async (_label, entries, lines) => {
    expect(await canonicalize(node(entries))).toEqual(lines)
  })

  it.each([
    ['a plain and a tagged string', ['x', tagged('en')],
      [valued('"x"'), valued('"x"@en')]],
    ['a string and an integer', ['5', 5],
      [valued('"5"'), valued(`"5"^^<${XSD}integer>`)]]
  ])('keeps %s apart', async (_label, v, lines) => {
    expect(await canonicalize(node({ v }))).toEqual(lines)
  })

  // Two nodes without an @id are two blank nodes, however
  // alike: they stay two and tie on their first-degree hash.
  it('keeps two alike anonymous nodes apart', async () => {
    const knows = [{ v: 'x' }, { v: 'x' }]
    await expect(canonicalize(node({ knows })))
      .rejects.toThrow('ambiguous blank nodes')
  })

  // Written once, the node with `w: "q"` hashes lower
  // (7864d853 against be2c409f) and takes c14n0. Counting the
  // repeat twice moves the other node's hash to 530678ec and
  // swaps the labels. Prefixes from Node's crypto.
  it('labels blank nodes by hashes over the set', async () => {
    const knows = [{ v: ['a', 'a'], w: 'p' }, { v: 'a', w: 'q' }]
    expect(await canonicalize(node({ knows }))).toEqual([
      quad(`${EX}knows`, '_:c14n0'),
      quad(`${EX}knows`, '_:c14n1'),
      `_:c14n0 <${EX}v> "a" .\n`,
      `_:c14n0 <${EX}w> "q" .\n`,
      `_:c14n1 <${EX}v> "a" .\n`,
      `_:c14n1 <${EX}w> "p" .\n`
    ])
  })
})

// The base-context prod specimen with a value repeated. The
// issuer signed each statement once, and its verifier counts
// the set, so a repeat verifies under the proofs as issued and
// a proof restating a signature for it fails.
describe('verifyDerivedProof: a repeat in the prod specimen', () => {
  const path = fileURLToPath(new URL(
    './fixtures/ecdsa-sd-prod-specimen-base-context.json', import.meta.url
  ))
  const specimen = JSON.parse(readFileSync(path, 'utf8'))
  const { view, issuer_multikeys_b64: keys } = specimen
  const subject = view.credentialSubject
  const { product } = subject
  const alias = subject.passportAlias
  const supplier = product.properties[4]

  const withSubject = (entries: object) =>
    ({ ...view, credentialSubject: { ...subject, ...entries } })

  // The view with the non-mandatory supplier row's value
  // given as `value`.
  const supplied = (value: unknown) => withSubject({
    product: {
      ...product,
      properties: [...product.properties.slice(0, 4), { ...supplier, value }]
    }
  })

  // Every proof of `doc` checked under its own issuer key.
  const verdicts = (doc: object, proofs: unknown[] = view.proof) =>
    Promise.all(proofs.map((proof, i) => {
      const key = new Uint8Array(Buffer.from(keys[i], 'base64'))
      return verifyDerivedProof({ ...doc, proof }, key)
    }))

  it.each([
    ['a mandatory value', withSubject({ passportAlias: [alias, alias] })],
    ['a non-mandatory value', supplied([supplier.value, supplier.value])],
    ['the issuer node written twice',
      withSubject({ issuer: [subject.issuer, subject.issuer] })]
  ])('verifies %s repeated', async (_label, doc) => {
    for (const result of await verdicts(doc)) {
      expect(result).toMatchObject({ verified: true })
    }
  })

  // A tagged copy is another statement, which no proof signs.
  it('fails a repeat beside a tagged copy', async () => {
    const copy = { '@value': supplier.value, '@language': 'en' }
    for (const result of await verdicts(supplied([supplier.value, copy]))) {
      expect(result).toMatchObject({ verified: false })
    }
  })

  // Each proof re-encoded as a reading of one line per
  // occurrence needs it: the supplier value's signature given
  // twice, the mandatory indexes after it moved down by one.
  // It names 100 lines where the set holds 99.
  it('fails a proof restating the signature of a repeat', async () => {
    const { proof: _proof, ...unsecured } = view
    const lines = await canonicalize(unsecured, { contexts: DPP_CONTEXTS })
    const at = lines.findIndex((l) => l.includes('"Acme Chemicals GmbH"'))
    const proofs = view.proof.map((proof: { proofValue: string }) => {
      const parsed = parseDerivedProofValue(proof.proofValue)
      const mandatory = new Set(parsed.mandatoryIndexes)
      const k = lines.slice(0, at).filter((_l, i) => !mandatory.has(i)).length
      const signatures = [...parsed.signatures]
      signatures.splice(k, 0, signatures[k])
      const mandatoryIndexes =
        parsed.mandatoryIndexes.map((i) => (i > at ? i + 1 : i))
      const proofValue = encodeDerivedProofValue({
        ...parsed, signatures, labelMap: [...parsed.labelMap], mandatoryIndexes
      })
      return { ...proof, proofValue }
    })
    const doc = supplied([supplier.value, supplier.value])
    for (const result of await verdicts(doc, proofs)) {
      expect(result).toMatchObject({
        verified: false, reason: 'mandatory index 99 out of range'
      })
    }
  })

  it('chain-hashes a public view with a repeat as issued', async () => {
    const pub = specimen.public_view
    const credentialSubject =
      { ...pub.credentialSubject, passportAlias: [alias, alias] }
    const doc = { ...pub, credentialSubject }
    expect(await hexChainHashOfSnapshot(doc as ProofCarrier))
      .toBe(specimen.public_view_hash_hex)
  })
})
