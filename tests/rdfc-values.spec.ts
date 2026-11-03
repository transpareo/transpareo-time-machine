/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * How the canonicalizer reads values: value objects, JSON
 * numbers, IRIs, language tags, terms named as IRIs, and a
 * node keyword beside its alias. The issuer canonicalizes
 * with a JSON-LD 1.1 processor, so a value read differently
 * here lets a signature stand over bytes the processor reads
 * as other statements. Each case is read as JSON-LD 1.1 reads
 * it or rejected.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { canonicalize } from '../src/crypto/rdfc'
import { verifyDerivedProof } from '../src/crypto/ecdsa-sd'

const EX = 'http://example.org/'
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const CTX = { ex: EX, xsd: XSD }
const VOCAB = { ...CTX, '@vocab': `${EX}v#` }
const DECIMAL = { '@id': 'ex:v', '@type': 'xsd:decimal' }
const ENGLISH = { '@id': 'ex:v', '@language': 'en' }

// ex:s with one `v` of `value`, `v` defined as `term`.
const valued = (value: unknown, term: unknown = 'ex:v') => ({
  '@context': { ...CTX, v: term }, '@id': 'ex:s', v: value
})
const quad = (object: string) => `<${EX}s> <${EX}v> ${object} .\n`

// ex:s with one `ref`, an @id-coerced term, of `iri`.
const referring = (iri: string, context = {}) => ({
  '@context': { ...CTX, ...context, ref: { '@id': 'ex:ref', '@type': '@id' } },
  '@id': 'ex:s',
  ref: iri
})

describe('canonicalize: value objects', () => {
  it.each([
    ['a @type', { '@type': 'xsd:decimal' }, `"x"^^<${XSD}decimal>`],
    ['a @language', { '@language': 'DE-ch' }, '"x"@de-ch'],
    ['an integer', { '@value': 5, '@type': 'xsd:decimal' },
      `"5"^^<${XSD}decimal>`],
    ['a boolean', { '@value': true, '@type': 'ex:flag' }, `"true"^^<${EX}flag>`]
  ])('reads one with %s', async (_label, entries, object) => {
    const value = { '@value': 'x', ...entries }
    expect(await canonicalize(valued(value))).toEqual([quad(object)])
  })

  // JSON-LD coerces a plain value by its term; a value object
  // keeps its own @type or @language, or has neither.
  it.each([
    ['a typed term', DECIMAL],
    ['a language term', ENGLISH],
    ['a plain term', 'ex:v']
  ])('rejects one with neither under %s', async (_label, term) => {
    await expect(canonicalize(valued({ '@value': '2.0' }, term)))
      .rejects.toThrow('unsupported value object')
  })

  it.each([
    ['@type and @language', { '@type': 'xsd:string', '@language': 'en' }],
    ['@index', { '@type': 'xsd:string', '@index': 'i' }],
    ['@direction', { '@language': 'en', '@direction': 'ltr' }],
    ['an @id', { '@type': 'xsd:string', '@id': 'ex:o' }],
    ['a @type that is no string', { '@type': ['xsd:string'] }],
    ['a @language that is no string', { '@language': 5 }],
    ['a number tagged with a language', { '@value': 5, '@language': 'en' }]
  ])('rejects one with %s', async (_label, entries) => {
    const value = { '@value': 'x', ...entries }
    await expect(canonicalize(valued(value)))
      .rejects.toThrow('unsupported value object')
  })

  // The credentials context aliases `type` to @type, and
  // JSON-LD reads the alias inside a value object too.
  it('rejects one typed through an alias', async () => {
    const doc = {
      '@context': { ...CTX, type: '@type', v: 'ex:v' },
      '@id': 'ex:s',
      v: { '@value': '2.0', type: 'xsd:decimal' }
    }
    await expect(canonicalize(doc)).rejects.toThrow('unsupported value object')
  })

  // @json makes one JSON literal there; read as an IRI it
  // would come out as the vocabulary plus '@json'.
  it.each(['@json', '@id', '@none'])('rejects a @type of %s', async (type) => {
    const doc = {
      '@context': { ...VOCAB, v: 'ex:v' },
      '@id': 'ex:s',
      v: { '@value': 'x', '@type': type }
    }
    await expect(canonicalize(doc)).rejects.toThrow(`unsupported IRI: ${type}`)
  })
})

describe('canonicalize: JSON numbers', () => {
  it.each([
    ['an integer', 5, 'ex:v', `"5"^^<${XSD}integer>`],
    ['an integer under a typed term', 5, DECIMAL, `"5"^^<${XSD}decimal>`],
    ['the largest safe integer', 2 ** 53 - 1, 'ex:v',
      `"9007199254740991"^^<${XSD}integer>`],
    ['minus zero', -0, 'ex:v', `"0"^^<${XSD}integer>`],
    ['a boolean under a typed term', false, DECIMAL, `"false"^^<${XSD}decimal>`]
  ])('reads %s', async (_label, value, term, object) => {
    expect(await canonicalize(valued(value, term))).toEqual([quad(object)])
  })

  // JSON-LD writes these in the double form ("2.5E0",
  // "1.0E21", "5.0E0"); an integer past 2^53 parses exactly in
  // the issuer's runtime and rounded here.
  it.each([
    ['a fraction under a typed term', 2.5, DECIMAL],
    ['a fraction in a value object',
      { '@value': 2.5, '@type': 'xsd:decimal' }, 'ex:v'],
    ['1e21', 1e21, 'ex:v'],
    ['-1e21', -1e21, 'ex:v'],
    ['an integer past 2^53', 2 ** 53, 'ex:v'],
    ['an integer under an xsd:double term', 5,
      { '@id': 'ex:v', '@type': 'xsd:double' }],
    ['an integer in a value object of xsd:double',
      { '@value': 5, '@type': 'xsd:double' }, 'ex:v']
  ])('rejects %s', async (_label, value, term) => {
    await expect(canonicalize(valued(value, term)))
      .rejects.toThrow('unsupported literal value')
  })

  it.each([null, { a: 1 }, ['a']])('rejects a @value of %j', async (value) => {
    const typed = { '@value': value, '@type': 'xsd:string' }
    await expect(canonicalize(valued(typed)))
      .rejects.toThrow('unsupported literal value')
  })
})

describe('canonicalize: IRIs', () => {
  it.each([
    'urn:uuid:7c9e6679-7425-40de-944b-e07fc1f90ae7',
    'did:web:x.test#key-1',
    'https://x.test/größe?a=1&b=2'
  ])('reads %s', async (iri) => {
    expect(await canonicalize(referring(iri)))
      .toEqual([`<${EX}s> <${EX}ref> <${iri}> .\n`])
  })

  // The issuer resolves against no base and drops a statement
  // whose IRI is relative.
  it.each(['target', '/target', '#target', '', '1x:target'])(
    'rejects a relative reference %j',
    async (iri) => {
      await expect(canonicalize(referring(iri)))
        .rejects.toThrow(`unsupported IRI: ${iri}`)
    }
  )

  it('rejects a relative node @id', async () => {
    const doc = {
      '@context': { ...CTX, name: 'ex:name' }, '@id': 's', name: 'A'
    }
    await expect(canonicalize(doc)).rejects.toThrow('unsupported IRI: s')
  })

  it.each([' ', '>', '<', '"', '{', '}', '|', '^', '`', '\\', '\n', '\u007f'])(
    'rejects a reference holding %j',
    async (char) => {
      await expect(canonicalize(referring(`https://x.test/a${char}b`)))
        .rejects.toThrow('unsupported IRI')
    }
  )

  // An IRI is written between < and > as it stands. This @id
  // and p2 would write one line equal to the statements
  // <s> <p1> "v1" and <s> <p2> "v2" joined, so a hash over the
  // joined lines could not tell the two documents apart.
  it('rejects an @id that would write a second statement', async () => {
    const doc = {
      '@context': { ...CTX, p2: 'ex:p2' },
      '@id': `${EX}s> <${EX}p1> "v1" .\n<${EX}s`,
      p2: 'v2'
    }
    await expect(canonicalize(doc)).rejects.toThrow('unsupported IRI')
  })

  it('rejects a datatype holding a space', async () => {
    const value = { '@value': 'x', '@type': `${EX}a b` }
    await expect(canonicalize(valued(value)))
      .rejects.toThrow(`unsupported IRI: ${EX}a b`)
  })

  // JSON-LD relabels a document's blank nodes; this one would
  // share its label with the node below, which has no @id.
  it('rejects a blank-node @id', async () => {
    const doc = {
      '@context': { ...CTX, name: 'ex:name', knows: 'ex:knows' },
      '@id': '_:b0',
      name: 'A',
      knows: { name: 'B' }
    }
    await expect(canonicalize(doc)).rejects.toThrow('unsupported IRI: _:b0')
  })

  // JSON-LD reads _: as a blank node whatever `_` maps to.
  it('never expands a _ prefix', async () => {
    const doc = referring('_:b', { _: 'https://x.test/' })
    await expect(canonicalize(doc)).rejects.toThrow('unsupported IRI: _:b')
  })

  it('rejects a keyword as a node type', async () => {
    const doc = { '@context': VOCAB, '@id': 'ex:s', '@type': '@json' }
    await expect(canonicalize(doc)).rejects.toThrow('unsupported IRI: @json')
  })
})

describe('canonicalize: language tags', () => {
  it.each(['de-CH', 'zh-Hans-CN', 'x-private1'])('reads %s', async (tag) => {
    const value = { '@value': 'x', '@language': tag }
    expect(await canonicalize(valued(value)))
      .toEqual([quad(`"x"@${tag.toLowerCase()}`)])
  })

  // The issuer drops a statement whose tag fails this shape,
  // and the tag is written after the literal as it stands.
  it.each(['de_CH', 'en us', '', 'en-', '-en', `en .\n<${EX}s`])(
    'rejects %j',
    async (tag) => {
      const value = { '@value': 'x', '@language': tag }
      await expect(canonicalize(valued(value)))
        .rejects.toThrow('unsupported language tag')
    }
  )

  it('rejects one a term carries', async () => {
    const term = { '@id': 'ex:v', '@language': 'en_US' }
    await expect(canonicalize(valued('x', term)))
      .rejects.toThrow('unsupported language tag: en_US')
  })
})

// A term with a colon before another character, or a slash,
// must expand to its own definition; JSON-LD aborts on
// `invalid IRI mapping` otherwise.
describe('canonicalize: a term named as an IRI', () => {
  const using = (term: string, definition: unknown) => ({
    '@context': [CTX, { [term]: definition }],
    '@id': 'ex:s',
    [term]: 'ex:A'
  })

  it.each([
    ['a compact IRI', 'ex:v', 'ex:other', 'unsupported @context term: ex:v'],
    ['a compact IRI in full', 'ex:v', { '@id': 'ex:other' },
      'unsupported @context term: ex:v'],
    ['an absolute IRI', `${EX}v`, 'ex:other',
      `unsupported @context term: ${EX}v`],
    ['a compact IRI aliasing @type', 'ex:type', '@type',
      'unsupported @context term: ex:type'],
    ['a path', 'a/b', 'ex:v', 'unsupported @context IRI: a/b']
  ])('rejects %s mapped elsewhere', async (_label, term, definition, text) => {
    await expect(canonicalize(using(term, definition))).rejects.toThrow(text)
  })

  it.each([
    ['as itself', 'ex:v', '"ex:A"'],
    ['in full, typed', { '@id': 'ex:v', '@type': 'xsd:decimal' },
      `"ex:A"^^<${XSD}decimal>`]
  ])('reads one defined %s', async (_label, definition, object) => {
    expect(await canonicalize(using('ex:v', definition)))
      .toEqual([quad(object)])
  })
})

// A node's @id and @type through the keyword, an alias or
// both, read as JSON-LD 1.1 expands them: a second @id aborts
// on `colliding keywords`, a second @type adds its values.
describe('canonicalize: a keyword beside its alias', () => {
  const ALIASED = {
    ...CTX, id: '@id', ident: '@id', type: '@type', kind: '@type',
    knows: 'ex:knows'
  }
  const node = (entries: object) => ({ '@context': ALIASED, ...entries })
  const typed = (s: string, ...types: string[]) =>
    types.map((t) => `<${EX}${s}> <${RDF_TYPE}> <${EX}${t}> .\n`)

  it.each([
    ['id before @id', { id: 'ex:a', '@id': 'ex:s' }],
    ['@id before id', { '@id': 'ex:s', id: 'ex:a' }],
    ['both naming one IRI', { id: 'ex:s', '@id': 'ex:s' }],
    ['two aliases', { id: 'ex:a', ident: 'ex:s' }],
    ['a nested node', { '@id': 'ex:s', knows: { id: 'ex:a', '@id': 'ex:o' } }]
  ])('rejects two @id: %s', async (_label, entries) => {
    await expect(canonicalize(node(entries)))
      .rejects.toThrow('colliding keywords: @id')
  })

  it.each([
    ['type before @type', { type: 'ex:A', '@type': 'ex:B' }],
    ['@type before type', { '@type': ['ex:B'], type: ['ex:A'] }],
    ['two aliases', { type: 'ex:A', kind: 'ex:B' }],
    ['an empty @type', { '@type': [], type: ['ex:A', 'ex:B'] }]
  ])('merges two @type: %s', async (_label, entries) => {
    expect(await canonicalize(node({ '@id': 'ex:s', ...entries })))
      .toEqual(typed('s', 'A', 'B'))
  })

  it('merges two @type on a nested node', async () => {
    const knows = { '@id': 'ex:o', type: 'ex:A', '@type': 'ex:B' }
    expect(await canonicalize(node({ '@id': 'ex:s', knows }))).toEqual([
      ...typed('o', 'A', 'B'), `<${EX}s> <${EX}knows> <${EX}o> .\n`
    ])
  })

  // The issuer applies type-scoped contexts key by key in key
  // order ('@type' before 'type'), each key's types in order,
  // so A's context comes last and its `v` holds.
  it('applies type-scoped contexts key by key', async () => {
    const doc = {
      '@context': {
        ...ALIASED,
        A: { '@id': 'ex:A', '@context': { v: 'ex:a' } },
        B: { '@id': 'ex:B', '@context': { v: 'ex:b' } }
      },
      '@id': 'ex:s',
      type: 'A',
      '@type': 'B',
      v: 'x'
    }
    expect(await canonicalize(doc))
      .toEqual([`<${EX}s> <${EX}a> "x" .\n`, ...typed('s', 'A', 'B')])
  })

  // JSON-LD aborts on both: an @type array and an @id in a
  // value object.
  it.each([
    ['typed twice', { '@type': 'xsd:decimal', type: 'xsd:string' }],
    ['with two @id', { id: 'ex:a', '@id': 'ex:b' }]
  ])('rejects a value object %s', async (_label, entries) => {
    const knows = { '@value': 'x', ...entries }
    await expect(canonicalize(node({ '@id': 'ex:s', knows })))
      .rejects.toThrow('unsupported value object')
  })
})

// The base-context prod specimen with an entry added before a
// node's signed keyword or alias: an added @type is a
// statement the issuer never signed, an added @id collides.
describe('verifyDerivedProof: a keyword added beside its alias', () => {
  const path = fileURLToPath(new URL(
    './fixtures/ecdsa-sd-prod-specimen-base-context.json', import.meta.url
  ))
  const { view, issuer_multikeys_b64: keys } =
    JSON.parse(readFileSync(path, 'utf8'))
  const subject = view.credentialSubject
  const EVIL = 'https://evil.example/'

  it.each([
    ['an @type before the credential type', { '@type': `${EVIL}R`, ...view }],
    ['an id before the subject @id',
      { ...view, credentialSubject: { id: `${EVIL}p`, ...subject } }],
    ['a type before the issuer @type', {
      ...view,
      credentialSubject: {
        ...subject, issuer: { type: `${EVIL}Org`, ...subject.issuer }
      }
    }]
  ])('fails with %s', async (_label, doc) => {
    const key = new Uint8Array(Buffer.from(keys[0], 'base64'))
    const proof = view.proof[0]
    expect(await verifyDerivedProof({ ...doc, proof }, key))
      .toMatchObject({ verified: false })
  })
})
