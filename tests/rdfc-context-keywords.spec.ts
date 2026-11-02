/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How the canonicalizer reads the keywords and term entries
 * of a context map. A context entry yields no statement of
 * its own, so one read differently from a JSON-LD processor
 * leaves the N-Quads, and a signature over them, standing
 * while the processor reads other statements. Each case is
 * read as JSON-LD 1.1 reads it or rejected.
 */

import { describe, expect, it } from 'vitest'
import { canonicalize } from '../src/crypto/rdfc'
import { DPP_CONTEXTS } from '../src/crypto/dpp-contexts'

const EX = 'http://example.org/'
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const CTX = { ex: EX, xsd: XSD }
const CREDENTIALS = 'https://www.w3.org/ns/credentials/v2'
const VC_V2 = 'https://transpareo.com/vocab/vc/v2'

// ex:s with one `name` of "A", read under `context`.
const named = (context: unknown) => ({
  '@context': context, '@id': 'ex:s', name: 'A'
})
const NAME_QUAD = `<${EX}s> <${EX}name> "A" .\n`

describe('canonicalize: context map keywords', () => {
  it.each([
    ['@language', 'en'],
    ['@direction', 'ltr'],
    ['@base', 'https://x.test/'],
    ['@import', 'https://x.test/context'],
    ['@propagate', true],
    ['@type', { '@container': '@set' }],
    ['@unknown', 1]
  ])('rejects %s', async (keyword, value) => {
    const doc = named({ ...CTX, name: 'ex:name', [keyword]: value })
    await expect(canonicalize(doc))
      .rejects.toThrow('unsupported @context keyword')
  })

  it('rejects one in a registered context', async () => {
    const url = 'https://x.test/context'
    const contexts = { [url]: { '@context': { '@language': 'en' } } }
    const doc = named([url, { ...CTX, name: 'ex:name' }])
    await expect(canonicalize(doc, { contexts }))
      .rejects.toThrow('unsupported @context keyword')
  })

  it('rejects one in a type-scoped context', async () => {
    const scope = { '@language': 'en' }
    const context = {
      ...CTX, name: 'ex:name', Thing: { '@id': 'ex:Thing', '@context': scope }
    }
    const doc = { ...named(context), '@type': 'Thing' }
    await expect(canonicalize(doc))
      .rejects.toThrow('unsupported @context keyword')
  })

  it('reads @version 1.1 and rejects any other', async () => {
    const context = { '@version': 1.1, ...CTX, name: 'ex:name' }
    expect(await canonicalize(named(context))).toEqual([NAME_QUAD])
    const other = named({ ...context, '@version': '1.1' })
    await expect(canonicalize(other))
      .rejects.toThrow('unsupported @context keyword')
  })

  it('rejects a @protected that is not a boolean', async () => {
    const doc = named({ '@protected': 'yes', ...CTX, name: 'ex:name' })
    await expect(canonicalize(doc))
      .rejects.toThrow('unsupported @context keyword')
  })
})

describe('canonicalize: @vocab', () => {
  it('clears the vocabulary on null', async () => {
    const vocab = { ...CTX, '@vocab': `${EX}v#` }
    await expect(canonicalize(named([vocab, { '@vocab': null }])))
      .rejects.toThrow('cannot expand term: name')
  })

  it('expands a compact @vocab against the context before it', async () => {
    expect(await canonicalize(named([CTX, { '@vocab': 'ex:v#' }])))
      .toEqual([`<${EX}s> <${EX}v#name> "A" .\n`])
  })

  it.each([
    [5, 'unsupported @context keyword'],
    ['_:v', 'unsupported IRI: _:v']
  ])('rejects a @vocab of %j', async (vocab, message) => {
    const doc = named([{ ...CTX, name: 'ex:name' }, { '@vocab': vocab }])
    await expect(canonicalize(doc)).rejects.toThrow(message)
  })
})

describe('canonicalize: protected terms', () => {
  const PROTECTED = { '@protected': true, ...CTX, name: 'ex:name' }

  it('rejects a later context changing a protected term', async () => {
    await expect(canonicalize(named([PROTECTED, { name: 'ex:other' }])))
      .rejects.toThrow('protected term redefinition: name')
  })

  it('rejects changing a term the credentials context protects', async () => {
    const doc = named([CREDENTIALS, { ...CTX, name: 'ex:name' }])
    await expect(canonicalize(doc, { contexts: DPP_CONTEXTS }))
      .rejects.toThrow('protected term redefinition: name')
  })

  it('reads a restated protected term and keeps it protected', async () => {
    const restated = [PROTECTED, { name: 'ex:name' }]
    expect(await canonicalize(named(restated))).toEqual([NAME_QUAD])
    const changed = named([...restated, { name: 'ex:other' }])
    await expect(canonicalize(changed))
      .rejects.toThrow('protected term redefinition: name')
  })

  it('protects a term its own definition marks', async () => {
    const context = { ...CTX, name: { '@id': 'ex:name', '@protected': true } }
    await expect(canonicalize(named([context, { name: 'ex:other' }])))
      .rejects.toThrow('protected term redefinition: name')
  })

  // JSON-LD lets the context a property carries change a
  // protected term, for that property's values only.
  it('lets a property-scoped context change one', async () => {
    const scope = { kind: 'ex:other' }
    const context = {
      ...PROTECTED,
      kind: 'ex:kind',
      p: { '@id': 'ex:p', '@type': '@vocab', '@context': scope }
    }
    const doc = { '@context': context, '@id': 'ex:s', p: 'kind' }
    expect(await canonicalize(doc))
      .toEqual([`<${EX}s> <${EX}p> <${EX}other> .\n`])
  })

  it('keeps a type-scoped context from changing one', async () => {
    const scope = { name: 'ex:other' }
    const context = {
      ...PROTECTED, Thing: { '@id': 'ex:Thing', '@context': scope }
    }
    const doc = { ...named(context), '@type': 'Thing' }
    await expect(canonicalize(doc))
      .rejects.toThrow('protected term redefinition: name')
  })
})

describe('canonicalize: term definition entries', () => {
  it.each([
    ['@reverse', 'ex:p'],
    ['@nest', '@nest'],
    ['@index', 'ex:i'],
    ['@prefix', true],
    ['@direction', 'ltr'],
    ['label', 'x']
  ])('rejects %s', async (key, value) => {
    const context = { ...CTX, name: { '@id': 'ex:name', [key]: value } }
    await expect(canonicalize(named(context)))
      .rejects.toThrow('unsupported @context term: name')
  })

  it.each([
    ['an alias of @value', '@value', '@value'],
    ['a keyword @id', { '@id': '@type' }, '@type'],
    ['a blank node', '_:b', '_:b']
  ])('rejects %s', async (_label, definition, iri) => {
    const doc = named({ ...CTX, name: definition })
    await expect(canonicalize(doc)).rejects.toThrow(`unsupported IRI: ${iri}`)
  })

  it.each([
    ['an array', ['xsd:decimal'], 'unsupported @context term: name'],
    ['@none', '@none', 'unsupported IRI: @none']
  ])('rejects a @type of %s', async (_label, type, message) => {
    const context = { ...CTX, name: { '@id': 'ex:name', '@type': type } }
    await expect(canonicalize(named(context))).rejects.toThrow(message)
  })

  it('reads @language null as no language', async () => {
    const context = { ...CTX, name: { '@id': 'ex:name', '@language': null } }
    expect(await canonicalize(named(context))).toEqual([NAME_QUAD])
  })

  it('rejects a @language that is not a string', async () => {
    const context = { ...CTX, name: { '@id': 'ex:name', '@language': 5 } }
    await expect(canonicalize(named(context)))
      .rejects.toThrow('unsupported @context term: name')
  })

  // A term's datatype is fixed where the term is defined; a
  // prefix redefined later moves what other values read.
  it('expands @type where the term is defined', async () => {
    const decimal = { '@id': 'ex:cap', '@type': 'xsd:decimal' }
    const context = [
      { ...CTX, xsd: `${EX}x#`, cap: decimal },
      { xsd: XSD }
    ]
    const doc = { '@context': context, '@id': 'ex:s', cap: '2.0' }
    expect(await canonicalize(doc))
      .toEqual([`<${EX}s> <${EX}cap> "2.0"^^<${EX}x#decimal> .\n`])
  })
})

describe('canonicalize: references inside one context map', () => {
  // A JSON-LD processor defines `dpp` first and reads T as
  // https://evil.example/Passport. Read top down, T stays
  // the absolute IRI dpp:Passport an issuer may have signed.
  it('rejects a term naming a prefix defined further down', async () => {
    const tail = { T: { '@id': 'dpp:Passport' }, dpp: 'https://evil.example/' }
    const doc = { '@context': [CTX, tail], '@id': 'ex:s', '@type': 'T' }
    await expect(canonicalize(doc)).rejects
      .toThrow('unsupported @context IRI: dpp:Passport')
  })

  it('rejects a datatype naming a prefix defined further down', async () => {
    const context = {
      ex: EX, cap: { '@id': 'ex:cap', '@type': 'x:decimal' }, x: XSD
    }
    const doc = { '@context': context, '@id': 'ex:s', cap: '2.0' }
    await expect(canonicalize(doc)).rejects
      .toThrow('unsupported @context IRI: x:decimal')
  })

  it('rejects a term naming itself', async () => {
    const doc = named([{ ...CTX, name: 'ex:name' }, { ex: 'ex:other/' }])
    await expect(canonicalize(doc)).rejects
      .toThrow('unsupported @context IRI: ex:other/')
  })

  it('reads a term naming one defined above it', async () => {
    const context = { ...CTX, label: 'ex:name', name: 'label' }
    expect(await canonicalize(named(context))).toEqual([NAME_QUAD])
  })
})

describe('canonicalize: a redefined term', () => {
  it('stops acting as a prefix once defined in full', async () => {
    const doc = {
      '@context': [CTX, { ex: { '@id': 'http://other.example/' } }],
      '@id': `${EX}s`,
      'ex:name': 'A'
    }
    expect(await canonicalize(doc))
      .toEqual([`<${EX}s> <ex:name> "A" .\n`])
  })

  it('stops acting as an alias', async () => {
    const doc = {
      '@context': [{ ...CTX, type: '@type' }, { type: 'ex:type' }],
      '@id': 'ex:s',
      type: 'A'
    }
    expect(await canonicalize(doc))
      .toEqual([`<${EX}s> <${EX}type> "A" .\n`])
  })
})

describe('canonicalize: term containers', () => {
  const tagged = (container: unknown) => ({
    '@context': { ...CTX, tag: { '@id': 'ex:tag', '@container': container } },
    '@id': 'ex:s',
    tag: ['a', 'b']
  })

  it.each(['@set', ['@set']])('reads %j as plain values', async (c) => {
    expect(await canonicalize(tagged(c))).toEqual([
      `<${EX}s> <${EX}tag> "a" .\n`,
      `<${EX}s> <${EX}tag> "b" .\n`
    ])
  })

  it.each([
    '@list', '@graph', '@index', '@language', '@id', '@type',
    ['@graph', '@set']
  ])('rejects a value under %j', async (container) => {
    await expect(canonicalize(tagged(container)))
      .rejects.toThrow('unsupported value of term: tag')
  })

  it('reads a document that leaves such a term unused', async () => {
    const list = { '@id': 'ex:tag', '@container': '@list' }
    const doc = named({ ...CTX, name: 'ex:name', tag: list })
    expect(await canonicalize(doc)).toEqual([NAME_QUAD])
  })

  it.each(['@bogus', 5])('rejects a container of %j', async (container) => {
    const tag = { '@id': 'ex:tag', '@container': container }
    const doc = named({ ...CTX, name: 'ex:name', tag })
    await expect(canonicalize(doc))
      .rejects.toThrow('unsupported @context term: tag')
  })

  // Every caller strips the proof before canonicalizing; the
  // credentials context files it into a named graph.
  it('rejects a proof left inside a credential', async () => {
    const doc = {
      '@context': [CREDENTIALS],
      '@id': 'https://x.test/p#credential',
      type: 'VerifiableCredential',
      proof: { '@id': 'https://x.test/p#proof' }
    }
    await expect(canonicalize(doc, { contexts: DPP_CONTEXTS }))
      .rejects.toThrow('unsupported value of term: proof')
  })

  it('rejects a value under a @json term', async () => {
    const doc = {
      '@context': [CREDENTIALS, VC_V2],
      '@id': 'https://x.test/p',
      _sd: ['abc']
    }
    await expect(canonicalize(doc, { contexts: DPP_CONTEXTS }))
      .rejects.toThrow('unsupported value of term: _sd')
  })
})
