/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Scoped JSON-LD -> RDF -> canonical N-Quads (RDFC-1.0 /
 * URDNA2015), the canonicalization ecdsa-sd-2023 verifies
 * over. This is NOT a general JSON-LD processor: it
 * handles exactly the shape our signed passports use and
 * rejects everything else, so the surface a verifier must
 * trust stays small and auditable.
 *
 * Supported input:
 *   - an @context that is a term map of prefix -> IRI,
 *     term -> IRI, or term -> { @id, @type?, @language?,
 *     @context?, @container?, @protected? }, or a URL the
 *     offline registry resolves to one. A map may also set
 *     @version 1.1, @vocab and @protected. It is read as
 *     JSON-LD reads it: keywords first, then each term
 *     against the definitions above it. A later context may
 *     restate a protected term, and change one only inside
 *     a property's own @context. @container @set reads as no
 *     container;
 *   - a term's own @context, as the W3C credentials context
 *     declares them: on a type it applies to the properties
 *     of a node of that type and not to the nodes inside
 *     them (VerifiableCredential, DataIntegrityProof); on a
 *     property it applies to that property's scalar values
 *     (proofPurpose). On a property holding a node, and an
 *     @context of null, it is rejected;
 *   - nodes identified by an absolute IRI @id (our docs
 *     carry one on every node) or by none, @type as a
 *     CURIE/IRI or an array of them (an alias's values join
 *     the keyword's), nested nodes, and arrays of values;
 *   - literals: plain strings (xsd:string), @language
 *     strings, @type-coerced typed literals, safe integers
 *     (xsd:integer), booleans (xsd:boolean), and value
 *     objects of @value plus a @type or a @language.
 *
 * A statement asserted more than once (a repeated value or
 * type, one @id written in two places, one literal written
 * two ways) counts once, as in the issuer's RDF graph.
 *
 * Rejected (fail closed): named graphs, @list / @set /
 * @reverse / @included / @nest, a context URL the offline
 * registry does not hold (nothing is fetched), a registered
 * context that lists further contexts, a @context on a node
 * below the root, a node holding @id twice (the keyword and
 * an alias, or two aliases), any other context keyword
 * (@base, @import, @language, @direction, @propagate) or
 * term entry (@reverse, @nest, @index, @prefix, @direction),
 * a term naming one defined further down its own map, a term
 * written as an IRI that maps to another, a changed
 * protected term, a value under a term with any other
 * container (@list, @graph, @index, a map) or of @type
 * @json, a JSON number that is no safe integer or is typed
 * xsd:double (JSON-LD writes a fraction, 1e21 and up and an
 * xsd:double as a double, and a larger integer may parse
 * rounded - decimals must arrive as a string plus a
 * datatype), any other value object (@value alone, another
 * key, a keyword @type), a relative or blank-node IRI and
 * one holding a character N-Quads escapes, a malformed
 * language tag, and any blank-node graph whose nodes do not
 * separate under first-degree hashing.
 *
 * Known deviation: a compact IRI here expands against any
 * prefix the context defines. JSON-LD 1.1 gates that on a
 * term definition's prefix flag, which a simple term
 * definition earns only when its IRI mapping ends in a
 * gen-delim character, so a prefix ending in anything else
 * expands here and stays a compact IRI in a conformant
 * processor. Every prefix our own documents use ends in
 * '#', so the two agree on them; a signed document should
 * still carry an absolute IRI in a value's `@type` rather
 * than a compact one, since a datatype that expands two
 * ways breaks the signature rather than the render.
 *
 * The label-replacement variant (canonicalize with a
 * labelMap) emits the canonical N-Quads in canonical
 * order but with each blank-node label swapped for the
 * mapped value, which is how a derived proof restates the
 * issuer's HMAC'd labels at verify time.
 */

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const XSD_STRING = `${XSD}string`
const XSD_INTEGER = `${XSD}integer`
const XSD_BOOLEAN = `${XSD}boolean`
const XSD_DOUBLE = `${XSD}double`
const RDF_LANG_STRING =
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'

// A scheme, a colon, and nothing the N-Quads form escapes:
// an IRI is written between < and > as it stands.
const ABSOLUTE_IRI = /^[a-z][a-z\d+.-]*:[^\p{Cc} <>"{}|^`\\]*$/iu

// The language tag shape the issuer keeps a statement for.
const LANGUAGE_TAG = /^[a-z]+(-[a-z\d]+)*$/i

interface TermDef {
  readonly id: string

  // A datatype IRI, expanded where the term is defined, or
  // '@id', '@vocab' or '@json'.
  readonly type?: string
  readonly language?: string

  // Any container but @set alone; a value under it is
  // rejected.
  readonly container?: string

  // The term's own @context, null where it clears the context.
  readonly scoped?: Record<string, JsonLdValue> | null
}

interface Context {
  readonly terms: ReadonlyMap<string, TermDef>
  readonly prefixes: ReadonlyMap<string, string>

  // Keyword aliases: a term mapped to '@id' or '@type'.
  // Data Integrity proof blocks alias 'type' to '@type',
  // so canonicalizing proof options needs this.
  readonly aliases: ReadonlyMap<string, string>

  // Protected terms (@protected), each with the definition it
  // was protected under, as `addContextTerm` writes it down.
  readonly protectedTerms: ReadonlyMap<string, string>

  // Default vocabulary (@vocab): a term with no definition
  // and no prefix expands to `vocab + term`. The DPP VC
  // base context sets one so every otherwise-undefined term
  // (the Data Integrity proof terms) still yields a triple.
  readonly vocab?: string
}

// An RDF term. Blank nodes carry an `id` like '_:b0';
// their labels are rewritten during canonicalization.
type Term =
  | { readonly kind: 'iri', readonly value: string }
  | { readonly kind: 'blank', readonly value: string }
  | {
      readonly kind: 'literal'
      readonly value: string
      readonly datatype: string
      readonly language?: string
    }

interface Quad {
  readonly subject: Term
  readonly predicate: Term
  readonly object: Term
}

type JsonLdValue = unknown

export interface CanonicalizeOptions {
  // Blank-node label replacement for the derived-proof
  // verify path; absent for plain RDFC-1.0.
  readonly labelMap?: ReadonlyMap<string, string>
  // Offline resolution for URL `@context` entries: maps a
  // context URL to its context document (`{ @context: ... }`
  // or the bare term map). Our DPP VCs reference the VC base
  // and transpareo contexts by URL; those are cached and
  // passed here so canonicalization never hits the network.
  // A URL missing here is rejected.
  readonly contexts?: Readonly<Record<string, JsonLdValue>>
}

// Canonicalize a JSON-LD document to an ordered array of
// canonical N-Quad lines.
export async function canonicalize(
  document: Record<string, JsonLdValue>,
  options: CanonicalizeOptions = {},
): Promise<string[]> {
  const context = parseContext(document['@context'], options.contexts)
  const quads: Quad[] = []
  const state: WalkState = { quads, nextBlank: 0 }
  walkNode(document, context, state)

  // RDF holds a set: a statement asserted twice counts once,
  // in the blank-node hashes as in the lines. Written with the
  // walk's own labels, one line is one statement.
  const keyed = quads.map((q): [string, Quad] => [serializeQuad(q, String), q])
  const statements = [...new Map(keyed).values()]
  return canonicalizeQuads(statements, options.labelMap)
}

// SHA-256 of the joined canonical N-Quads, the digest the
// ecdsa-sd construction feeds into its signatures (the
// proof-options hash and the mandatory-statements hash).
export async function hashNQuads(
  lines: readonly string[],
): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(lines.join(''))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return new Uint8Array(digest)
}

interface WalkState {
  readonly quads: Quad[]
  nextBlank: number
}

// Emit the quads for one node and return the RDF term
// that stands for it (its @id IRI, or a fresh blank node).
// `outer` is the context the node was reached with; its
// properties read it with the node's type-scoped contexts on
// top, and the nodes inside them read `outer` again.
function walkNode(
  rawNode: Record<string, JsonLdValue>, outer: Context, state: WalkState,
): Term {
  const context = withTypeScopes(rawNode, outer)
  const node = normalizeKeywords(rawNode, context)
  const id = node['@id']
  const subject: Term = id === undefined
    ? { kind: 'blank', value: `_:b${state.nextBlank++}` }
    : { kind: 'iri', value: expandIri(id, context, false) }

  for (const t of asArray(node['@type'])) {
    state.quads.push({
      subject,
      predicate: { kind: 'iri', value: RDF_TYPE },
      object: { kind: 'iri', value: expandIri(t, outer, true) }
    })
  }

  for (const [term, raw] of Object.entries(node)) {
    if (term.startsWith('@')) continue

    // A defined term carries its IRI (and any coercion); an
    // undefined term expands through @vocab, or is rejected
    // when no vocabulary grounds it.
    const def = readableTerm(term, context)
    const predicate: Term = {
      kind: 'iri', value: def ? def.id : expandIri(term, context, true),
    }
    const scope = { context: scopedContext(def, context, true), outer }
    for (const value of asArray(raw)) {
      state.quads.push({
        subject, predicate, object: toObject(value, def, scope, state),
      })
    }
  }
  return subject
}

// The node's context with each type's @context on top, applied
// as JSON-LD does: per key that is or aliases @type, in key
// order, then per type name in order.
function withTypeScopes(
  node: Record<string, JsonLdValue>, outer: Context,
): Context {
  const types = Object.keys(node)
    .filter((key) => (outer.aliases.get(key) ?? key) === '@type')
    .sort(order)
    .flatMap((key) => asArray(node[key])
      .filter((t): t is string => typeof t === 'string')
      .sort(order))
  let context = outer
  for (const t of types) context = scopedContext(outer.terms.get(t), context)
  return context
}

// `context` with a term's own @context on top; one of null
// throws. A property's may change a protected term, a type's
// may not.
function scopedContext(
  def: TermDef | undefined, context: Context, property = false
): Context {
  if (def?.scoped === undefined) return context
  if (def.scoped === null) throw new Error('unsupported null @context')
  return extendContext(context, def.scoped, property)
}

// A term's definition, unless JSON-LD restructures its
// values: a container (list, graph, index or map) or a JSON
// literal.
function readableTerm(term: string, context: Context): TermDef | undefined {
  const def = context.terms.get(term)
  if (def?.container !== undefined || def?.type === '@json') {
    throw new Error(`unsupported value of term: ${term}`)
  }
  return def
}

interface Scope {
  readonly context: Context
  readonly outer: Context
}

const SUPPORTED_KEYWORDS = new Set(['@context', '@id', '@type'])

// Rewrite aliased keys to their keyword, each an own property
// ("__proto__" included). A keyword besides @context, @id and
// @type throws; as in JSON-LD, a second @id throws and a
// second @type adds its values.
function normalizeKeywords(
  node: Record<string, JsonLdValue>, context: Context,
): Record<string, JsonLdValue> {
  const out: Record<string, JsonLdValue> = Object.create(null)
  for (const [key, value] of Object.entries(node)) {
    const keyword = context.aliases.get(key) ?? key
    if (keyword.startsWith('@') && !SUPPORTED_KEYWORDS.has(keyword)) {
      throw new Error(`unsupported JSON-LD keyword: ${keyword}`)
    }
    if (!(keyword in out)) {
      out[keyword] = value
    } else if (keyword === '@type') {
      out[keyword] = asArray(out[keyword]).concat(value)
    } else {
      throw new Error(`colliding keywords: ${keyword}`)
    }
  }
  return out
}

// Resolve a term value to an RDF object term. A nested
// object is either a value object ({ @value, ... }) or a
// node (recurse); a @type:@id coercion makes a string an
// IRI; a datatype coercion types a literal, a language one
// tags a string; otherwise the JSON type decides.
function toObject(
  value: JsonLdValue, def: TermDef | undefined, scope: Scope, state: WalkState,
): Term {
  const { context } = scope
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, JsonLdValue>
    if ('@context' in obj) throw new Error('unsupported nested @context')
    if ('@value' in obj) return valueObject(obj, context)
    if (def?.scoped !== undefined) {
      throw new Error('unsupported property-scoped @context on a node')
    }
    return walkNode(obj, scope.outer, state)
  }

  // @id-coerced values expand as document IRIs; @vocab-coerced
  // ones through the vocabulary. Everything else is a literal.
  const type = def?.type
  if (type === '@id' || type === '@vocab') {
    return { kind: 'iri', value: expandIri(value, context, type === '@vocab') }
  }
  if (typeof value === 'string' && !type && def?.language !== undefined) {
    return langLiteral(value, def.language)
  }
  return literal(value, type)
}

// A value object reads only its own @type or @language:
// JSON-LD applies a term's coercion to plain values. It holds
// @value and one of the two as a string, and a language tags
// a string only. Anything else throws, the keys JSON-LD reads
// besides (@index, @direction, an alias of @type) included.
function valueObject(obj: Record<string, JsonLdValue>, context: Context): Term {
  const { '@value': value, '@type': type, '@language': language } = obj
  if (Object.keys(obj).length === 2) {
    if (typeof type === 'string') {
      return literal(value, expandIri(type, context, true))
    }
    if (typeof language === 'string' && typeof value === 'string') {
      return langLiteral(value, language)
    }
  }
  throw new Error('unsupported value object')
}

// A JSON scalar as a literal of `datatype`, else of the one
// its JSON type implies. A number reads only as a safe
// integer outside xsd:double: JSON-LD writes a fraction, a
// magnitude of 1e21 or more and an xsd:double number as a
// double ("2.5E0"), and an integer past 2^53 parses exactly
// in the issuer's runtime and rounded here.
function literal(value: JsonLdValue, datatype?: string): Term {
  const json = typeof value
  const integer = Number.isSafeInteger(value) && datatype !== XSD_DOUBLE
  if (json !== 'string' && json !== 'boolean' && !integer) {
    throw new Error(`unsupported literal value: ${String(value)}`)
  }
  const implied = json === 'string' ? XSD_STRING
    : json === 'boolean' ? XSD_BOOLEAN : XSD_INTEGER
  return {
    kind: 'literal', value: String(value), datatype: datatype ?? implied
  }
}

// The tag is written after the literal as it stands, and the
// issuer drops a statement whose tag fails the same shape.
function langLiteral(value: string, language: string): Term {
  if (!LANGUAGE_TAG.test(language)) {
    throw new Error(`unsupported language tag: ${language}`)
  }
  return {
    kind: 'literal', value, datatype: RDF_LANG_STRING,
    language: language.toLowerCase(),
  }
}

// Expand a term or reference to an absolute IRI. A CURIE
// whose prefix is defined expands against the prefix map; a
// colon with an undefined prefix or `_`, or followed by '//',
// leaves the value standing (https:, did:, urn:, and an xsd:
// whose prefix the context leaves undefined). A bare word
// expands through the term map then @vocab in vocab position
// (a predicate, a @type, a @vocab-coerced value); in @id
// position it stands too. Anything but a string, a keyword,
// or a result that is no absolute IRI (a relative or
// blank-node one) or holds a character N-Quads escapes,
// throws: the issuer reads it another way, or it writes as
// more than one statement.
function expandIri(
  value: JsonLdValue, context: Context, vocab: boolean
): string {
  if (typeof value !== 'string' || value.startsWith('@')) {
    throw new Error(`unsupported IRI: ${String(value)}`)
  }
  const colon = value.indexOf(':')
  let iri = value
  if (colon > 0) {
    const prefix = value.slice(0, colon)
    const absolute = prefix === '_' || value.startsWith('//', colon + 1)
    const base = absolute ? undefined : context.prefixes.get(prefix)
    if (base) iri = base + value.slice(colon + 1)
  } else if (vocab) {
    const def = context.terms.get(value)
    if (!def && context.vocab === undefined) {
      throw new Error(`cannot expand term: ${value}`)
    }
    iri = def ? def.id : context.vocab + value
  }
  if (!ABSOLUTE_IRI.test(iri)) throw new Error(`unsupported IRI: ${value}`)
  return iri
}

function parseContext(
  raw: JsonLdValue, registry?: Readonly<Record<string, JsonLdValue>>,
): Context {
  let context: Context = {
    terms: new Map(), prefixes: new Map(), aliases: new Map(),
    protectedTerms: new Map()
  }
  for (const entry of asArray(raw)) {
    context = extendContext(context, resolveContextEntry(entry, registry))
  }
  return context
}

// A context while one map is read into it.
interface ContextDraft {
  readonly terms: Map<string, TermDef>
  readonly prefixes: Map<string, string>
  readonly aliases: Map<string, string>
  readonly protectedTerms: Map<string, string>
  vocab?: string
}

// How the terms of the map being read are defined.
interface MapScope {
  // The map's @protected, the default for its terms.
  readonly protect: boolean

  // A property-scoped context may change a protected term.
  readonly override: boolean

  // The map's terms not defined yet, the current one included.
  readonly pending: Set<string>
}

// A copy of `base` with the definitions of `map` on top, read
// as JSON-LD reads a context: the map's keywords first, then
// each term against the definitions above it.
function extendContext(
  base: Context, map: Record<string, JsonLdValue>, override = false
): Context {
  const draft: ContextDraft = {
    terms: new Map(base.terms),
    prefixes: new Map(base.prefixes),
    aliases: new Map(base.aliases),
    protectedTerms: new Map(base.protectedTerms),
    vocab: base.vocab
  }
  const terms = Object.keys(map).filter((key) => !key.startsWith('@'))
  const protect = readContextKeywords(map, draft)
  const scope: MapScope = { protect, override, pending: new Set(terms) }
  for (const term of terms) {
    addContextTerm(term, map[term], draft, scope)
    scope.pending.delete(term)
  }
  return draft
}

// The map's own keywords, read before its terms; returns its
// @protected. @vocab null clears the vocabulary, a string
// expands against the context before this map. Any other
// keyword throws: @base, @import, @language, @direction and
// @propagate each change what JSON-LD reads.
function readContextKeywords(
  map: Record<string, JsonLdValue>, draft: ContextDraft
): boolean {
  const {
    '@version': version = 1.1, '@vocab': vocab,
    '@protected': protect = false, ...terms
  } = map
  const valid = version === 1.1 && typeof protect === 'boolean'
    && (vocab == null || typeof vocab === 'string')
    && !Object.keys(terms).some((key) => key.startsWith('@'))
  if (!valid) throw new Error('unsupported @context keyword')
  if (vocab !== undefined) {
    draft.vocab = vocab === null ? undefined : definitionIri(vocab, draft)
  }
  return protect
}

// A context entry is either an inline term map or a URL
// resolved from the offline registry to its document
// (`{ @context: ... }` or a bare map), which must be one term
// map too. Nothing is fetched: a URL outside the registry's
// own keys throws, since a context read as absent lets a
// signature verify while a JSON-LD processor reads its terms.
function resolveContextEntry(
  entry: JsonLdValue, registry?: Readonly<Record<string, JsonLdValue>>,
): Record<string, JsonLdValue> {
  let map = entry
  if (typeof entry === 'string') {
    if (!registry || !Object.hasOwn(registry, entry)) {
      throw new Error(`cannot resolve @context: ${entry}`)
    }
    const doc = registry[entry] as Record<string, JsonLdValue> | null
    map = doc?.['@context'] ?? doc
  }
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error('unsupported @context entry')
  }
  return map as Record<string, JsonLdValue>
}

// One term as this canonicalizer reads it: a keyword alias,
// or a definition plus whether the term also serves as a
// prefix, which every simple string definition does.
type Definition =
  | { readonly alias: string }
  | { readonly def: TermDef, readonly prefix: boolean }

// Define one term over whatever it meant before. A term
// written as an IRI (a colon before another character, or a
// slash) must expand to its own definition, as JSON-LD
// requires. A protected term stays as it is when restated
// and throws when changed, unless the map is property-scoped.
function addContextTerm(
  term: string, raw: JsonLdValue, draft: ContextDraft, scope: MapScope
): void {
  const [definition, protect] = parseTerm(term, raw, draft, scope)
  const iri = 'alias' in definition ? definition.alias : definition.def.id
  if (/:.|\//.test(term) && definitionIri(term, draft, scope.pending) !== iri) {
    throw new Error(`unsupported @context term: ${term}`)
  }
  const signature = JSON.stringify(definition)
  const previous = draft.protectedTerms.get(term)
  if (previous !== undefined && !scope.override) {
    if (previous === signature) return
    throw new Error(`protected term redefinition: ${term}`)
  }
  draft.terms.delete(term)
  draft.prefixes.delete(term)
  draft.aliases.delete(term)
  draft.protectedTerms.delete(term)
  if ('alias' in definition) {
    draft.aliases.set(term, definition.alias)
  } else {
    draft.terms.set(term, definition.def)
    if (definition.prefix) draft.prefixes.set(term, definition.def.id)
  }
  if (protect) draft.protectedTerms.set(term, signature)
}

const TYPE_KEYWORDS = new Set(['@id', '@vocab', '@json'])
const CONTAINERS = new Set([
  '@list', '@index', '@language', '@id', '@type', '@graph'
])

// A term definition and whether it is protected. A simple
// string aliases @id or @type, or names the term's IRI. A
// definition map holds @id, @type, @language, @context,
// @container and @protected; the other JSON-LD entries
// (@reverse, @nest, @index, @prefix, @direction) throw. A
// @type keeps '@id', '@vocab' or '@json', and an IRI expands
// here, where JSON-LD fixes it. @language null reads as an
// absent one, and @container @set as none: RDF values form a
// set already.
function parseTerm(
  term: string, raw: JsonLdValue, context: Context, scope: MapScope
): [Definition, boolean] {
  const { pending } = scope
  if (raw === '@id' || raw === '@type') return [{ alias: raw }, scope.protect]
  if (typeof raw === 'string') {
    const id = definitionIri(raw, context, pending)
    return [{ def: { id }, prefix: true }, scope.protect]
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`unsupported @context term: ${term}`)
  }
  const {
    '@id': id, '@type': type, '@language': language,
    '@context': scoped, '@container': container,
    '@protected': protect = scope.protect, ...stray
  } = raw as Record<string, JsonLdValue>
  const kinds = asArray(container).filter((k) => k !== '@set')
  const valid = typeof id === 'string' && typeof protect === 'boolean'
    && (type === undefined || typeof type === 'string')
    && (language == null || typeof language === 'string')
    && (scoped === undefined || typeof scoped === 'object')
    && !Array.isArray(scoped)
    && kinds.every((k) => CONTAINERS.has(k as string))
    && Object.keys(stray).length === 0
  if (!valid) throw new Error(`unsupported @context term: ${term}`)
  const def: TermDef = {
    id: definitionIri(id, context, pending),
    type: type === undefined || TYPE_KEYWORDS.has(type)
      ? type : definitionIri(type, context, pending),
    language: language ?? undefined,
    container: kinds.length === 0 ? undefined : kinds.join(' '),
    scoped: scoped as TermDef['scoped']
  }
  return [{ def, prefix: false }, protect]
}

// An IRI inside a context (a term's @id or @type, @vocab),
// expanded against the definitions above it as a vocabulary
// IRI. JSON-LD defines a map's terms as a whole, so naming a
// term further down the same map (`pending`, the term itself
// included) throws instead of reading it two ways.
function definitionIri(
  value: string, context: Context, pending?: ReadonlySet<string>
): string {
  const colon = value.indexOf(':')
  const head = colon > 0 ? value.slice(0, colon) : value
  if (pending?.has(head)) throw new Error(`unsupported @context IRI: ${value}`)
  return expandIri(value, context, true)
}

function asArray(value: JsonLdValue): JsonLdValue[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

// URDNA2015 over the collected quads, returning canonical
// N-Quad lines. Blank nodes get canonical c14n labels via
// first-degree hashing; a labelMap swaps those labels for
// the derived-proof restatement while keeping order.
async function canonicalizeQuads(
  quads: readonly Quad[], labelMap?: ReadonlyMap<string, string>,
): Promise<string[]> {
  const labels = await canonicalBlankLabels(quads)
  const canonical = (id: string) => labels.get(id) ?? id
  const written = (id: string) => {
    const label = canonical(id)
    if (!labelMap) return label
    const mapped = labelMap.get(label.slice(2))
    if (mapped === undefined) {
      throw new Error(`label map has no entry for ${label}`)
    }
    return `_:${mapped}`
  }
  return quads
    .map((q) => [serializeQuad(q, canonical), serializeQuad(q, written)])
    .sort(([a], [b]) => order(a, b))
    .map(([, line]) => line)
}

// Code point order, as RDFC-1.0 and the issuer's UTF-8 byte
// sort have it (UTF-16 code units put a surrogate pair before
// U+E000 to U+FFFF). A string ending first sorts first.
function order(a: string, b: string): number {
  let i = 0
  while (a[i] && a[i] === b[i]) i++
  return (a.codePointAt(i) ?? -1) - (b.codePointAt(i) ?? -1)
}

// Assign each blank node a canonical label. With no blank
// nodes this is empty; otherwise labels come from sorting
// the first-degree hashes. Two blank nodes that share a
// first-degree hash would need URDNA2015's n-degree step,
// which our documents are shaped to avoid, so a tie is a
// hard error rather than a silent mislabel.
async function canonicalBlankLabels(
  quads: readonly Quad[],
): Promise<Map<string, string>> {
  const ids = quads.flatMap((q) => [q.subject, q.object])
    .filter((t) => t.kind === 'blank')
    .map((t) => t.value)
  const labels = new Map<string, string>()
  const hashed: Array<{ id: string, hash: string }> = []
  for (const id of new Set(ids)) {
    hashed.push({ id, hash: await firstDegreeHash(id, quads) })
  }
  hashed.sort((a, b) => order(a.hash, b.hash))
  for (let i = 0; i < hashed.length; i++) {
    if (hashed[i].hash === hashed[i - 1]?.hash) {
      throw new Error('ambiguous blank nodes: n-degree hashing unsupported')
    }
    labels.set(hashed[i].id, `_:c14n${i}`)
  }
  return labels
}

// URDNA2015 first-degree hash (§4.6): serialize every quad
// the node is the subject or object of, with the node itself
// written as '_:a' and any other blank node as '_:z', sort,
// hash.
async function firstDegreeHash(
  id: string, quads: readonly Quad[],
): Promise<string> {
  const lines = quads
    .filter((q) => [q.subject, q.object]
      .some((t) => t.kind === 'blank' && t.value === id))
    .map((q) => serializeQuad(q, (b) => (b === id ? '_:a' : '_:z')))
    .sort(order)
  return hex(await hashNQuads(lines))
}

// One N-Quad line; `blank` writes each blank node's label.
function serializeQuad(quad: Quad, blank: (id: string) => string): string {
  const line = [quad.subject, quad.predicate, quad.object].map((t) => (
    t.kind === 'iri' ? `<${t.value}>`
      : t.kind === 'literal' ? serializeLiteral(t) : blank(t.value)
  ))
  return `${line.join(' ')} .\n`
}

function serializeLiteral(term: Term & { kind: 'literal' }): string {
  const lex = `"${escapeLiteral(term.value)}"`
  if (term.language !== undefined) return `${lex}@${term.language}`
  if (term.datatype === XSD_STRING) return lex
  return `${lex}^^<${term.datatype}>`
}

// Canonical N-Quads (RDFC-1.0, Appendix A) writes a literal's
// characters as they stand, except the quote, the backslash,
// the C0 controls, DEL, a lone surrogate, U+FFFE and U+FFFF.
// LITERAL_ESCAPED lists the characters kept and matches the
// rest; each takes its ECHAR below or \u and four uppercase
// hex digits, as the issuer writes them.
const LITERAL_ESCAPED =
  /[^ !#-[\]-~\x80-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu

const ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\', '"': '\\"', '\b': '\\b', '\t': '\\t', '\n': '\\n',
  '\f': '\\f', '\r': '\\r'
}

function escapeLiteral(value: string): string {
  return value.replace(LITERAL_ESCAPED, (c) => {
    const code = c.charCodeAt(0).toString(16).toUpperCase()
    return ESCAPES[c] ?? `\\u${code.padStart(4, '0')}`
  })
}

function hex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}
