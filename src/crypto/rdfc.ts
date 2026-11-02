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
 *   - nodes identified by an explicit @id (IRI, our docs
 *     carry one on every node), @type as a CURIE/IRI or an
 *     array of them, nested nodes, and arrays of values;
 *   - literals: plain strings (xsd:string), @language
 *     strings, @type-coerced typed literals, integers
 *     (xsd:integer), and booleans (xsd:boolean).
 *
 * Rejected (fail closed): named graphs, @list / @set /
 * @reverse / @included / @nest, a context URL the offline
 * registry does not hold (nothing is fetched), a registered
 * context that lists further contexts, a @context on a node
 * below the root, any other context keyword (@base, @import,
 * @language, @direction, @propagate) or term entry
 * (@reverse, @nest, @index, @prefix, @direction), a term
 * naming one defined further down its own map, a changed
 * protected term, a value under a term with any other
 * container (@list, @graph, @index, a map) or of @type
 * @json, an untyped non-integer JSON number (its RDF
 * datatype is ambiguous - typed decimals must arrive as a
 * string plus a datatype), and any blank-node graph whose
 * nodes do not separate under first-degree hashing.
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
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer'
const XSD_BOOLEAN = 'http://www.w3.org/2001/XMLSchema#boolean'
const RDF_LANG_STRING =
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'

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
  return canonicalizeQuads(quads, options.labelMap)
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
  rejectUnsupportedKeywords(node)
  const subject = nodeSubject(node, context, state)

  if ('@type' in node) {
    for (const t of asArray(node['@type'])) {
      if (typeof t !== 'string') throw new Error('@type must be a string')
      state.quads.push({
        subject,
        predicate: { kind: 'iri', value: RDF_TYPE },
        object: { kind: 'iri', value: expandIri(t, outer, true) },
      })
    }
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
    const scope = { context: propertyScope(def, context), outer }
    for (const value of asArray(raw)) {
      state.quads.push({
        subject, predicate, object: toObject(value, def, scope, state),
      })
    }
  }
  return subject
}

// The node's context with the @context of each of its types
// applied, in lexicographic order of the type names.
function withTypeScopes(
  node: Record<string, JsonLdValue>, outer: Context,
): Context {
  const types: string[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key !== '@type' && outer.aliases.get(key) !== '@type') continue
    for (const t of asArray(value)) if (typeof t === 'string') types.push(t)
  }
  let context = outer
  for (const t of types.sort()) {
    const def = outer.terms.get(t)
    if (def?.scoped === undefined) continue
    if (def.scoped === null) throw new Error(`unsupported null @context: ${t}`)
    context = extendContext(context, def.scoped)
  }
  return context
}

function propertyScope(def: TermDef | undefined, context: Context): Context {
  if (def?.scoped === undefined) return context
  if (def.scoped === null) throw new Error('unsupported null @context')
  return extendContext(context, def.scoped, true)
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

// Rewrite aliased keys to their real keyword so the rest
// of the walk sees '@id' / '@type' directly.
function normalizeKeywords(
  node: Record<string, JsonLdValue>, context: Context,
): Record<string, JsonLdValue> {
  if (context.aliases.size === 0) return node
  const out: Record<string, JsonLdValue> = {}
  for (const [key, value] of Object.entries(node)) {
    out[context.aliases.get(key) ?? key] = value
  }
  return out
}

function nodeSubject(
  node: Record<string, JsonLdValue>, context: Context, state: WalkState,
): Term {
  const id = node['@id']
  if (id === undefined) {
    return { kind: 'blank', value: `_:b${state.nextBlank++}` }
  }
  if (typeof id !== 'string') throw new Error('@id must be a string')
  if (id.startsWith('_:')) return { kind: 'blank', value: id }
  return { kind: 'iri', value: expandIri(id, context, false) }
}

// Resolve a term value to an RDF object term. A nested
// object is either a value object ({ @value, ... }) or a
// node (recurse); a @type:@id coercion makes a string an
// IRI; a datatype coercion types a literal; otherwise the
// JSON type decides.
function toObject(
  value: JsonLdValue, def: TermDef | undefined, scope: Scope, state: WalkState,
): Term {
  const { context } = scope
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, JsonLdValue>
    if ('@context' in obj) throw new Error('unsupported nested @context')
    if ('@value' in obj) return valueObject(obj, def, context)
    if (def?.scoped !== undefined) {
      throw new Error('unsupported property-scoped @context on a node')
    }
    return walkNode(obj, scope.outer, state)
  }

  // @id-coerced values expand as document IRIs; @vocab-coerced
  // ones through the vocabulary. Everything else is a literal.
  if (def?.type === '@id' || def?.type === '@vocab') {
    if (typeof value !== 'string') throw new Error('IRI value must be a string')
    const vocab = def.type === '@vocab'
    return { kind: 'iri', value: expandIri(value, context, vocab) }
  }
  return scalarLiteral(value, def)
}

function valueObject(
  obj: Record<string, JsonLdValue>, def: TermDef | undefined, context: Context,
): Term {
  const value = obj['@value']
  const language = (obj['@language'] ?? def?.language) as string | undefined
  const typeRaw = obj['@type']
  if (typeof typeRaw === 'string') {
    return literal(String(value), expandIri(typeRaw, context, true))
  }
  if (language !== undefined) return langLiteral(String(value), language)
  return scalarLiteral(value, def)
}

function scalarLiteral(value: JsonLdValue, def: TermDef | undefined): Term {
  if (def?.type && def.type !== '@id' && def.type !== '@vocab') {
    return literal(String(value), def.type)
  }
  if (typeof value === 'string') {
    if (def?.language !== undefined) return langLiteral(value, def.language)
    return literal(value, XSD_STRING)
  }
  if (typeof value === 'boolean') {
    return literal(value ? 'true' : 'false', XSD_BOOLEAN)
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error('non-integer JSON number: type a decimal explicitly')
    }
    return literal(String(value), XSD_INTEGER)
  }
  throw new Error(`unsupported literal value: ${String(value)}`)
}

function literal(value: string, datatype: string): Term {
  return { kind: 'literal', value, datatype }
}

function langLiteral(value: string, language: string): Term {
  return {
    kind: 'literal', value, datatype: RDF_LANG_STRING,
    language: language.toLowerCase(),
  }
}

// Expand a term or reference to an IRI. A CURIE whose
// prefix is defined expands against the prefix map; a
// colon with an undefined prefix, or followed by '//', is
// already an absolute IRI (https:, did:, urn:, and an xsd:
// whose prefix the context leaves undefined) and passes
// through. A bare word expands through the term map then
// @vocab in vocab position (a predicate, a @type, a
// @vocab-coerced value); in @id position it is a document
// reference and passes through.
function expandIri(value: string, context: Context, vocab: boolean): string {
  const colon = value.indexOf(':')
  if (colon > 0) {
    const prefix = value.slice(0, colon)
    const absolute = value.startsWith('//', colon + 1)
    const base = absolute ? undefined : context.prefixes.get(prefix)
    return base ? base + value.slice(colon + 1) : value
  }
  if (!vocab) return value
  const def = context.terms.get(value)
  if (def) return def.id
  if (context.vocab !== undefined) return context.vocab + value
  throw new Error(`cannot expand term: ${value}`)
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

// Define one term over whatever it meant before. A protected
// term stays as it is when restated and throws when changed,
// unless the map is property-scoped.
function addContextTerm(
  term: string, raw: JsonLdValue, draft: ContextDraft, scope: MapScope
): void {
  const [definition, protect] = parseTerm(term, raw, draft, scope)
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
    && kinds.every((k) => CONTAINERS.has(k as string))
    && Object.keys(stray).length === 0
  if (!valid) throw new Error(`unsupported @context term: ${term}`)
  const def: TermDef = {
    id: definitionIri(id, context, pending),
    type: type === undefined || TYPE_KEYWORDS.has(type)
      ? type : definitionIri(type, context, pending),
    language: language ?? undefined,
    container: kinds.length === 0 ? undefined : kinds.join(' '),
    scoped: scoped === undefined ? undefined : scopedMap(term, scoped)
  }
  return [{ def, prefix: false }, protect]
}

// An IRI inside a context (a term's @id or @type, @vocab),
// expanded against the definitions above it as a vocabulary
// IRI. JSON-LD defines a map's terms as a whole, so naming a
// term further down the same map (`pending`, the term itself
// included) throws instead of reading it two ways. So does a
// keyword, and a blank node, which would be written as an IRI.
function definitionIri(
  value: string, context: Context, pending?: ReadonlySet<string>
): string {
  const colon = value.indexOf(':')
  const head = colon > 0 ? value.slice(0, colon) : value
  if (value.startsWith('@') || head === '_' || pending?.has(head)) {
    throw new Error(`unsupported @context IRI: ${value}`)
  }
  return expandIri(value, context, true)
}

function scopedMap(
  term: string, scoped: JsonLdValue,
): Record<string, JsonLdValue> | null {
  if (scoped === null) return null
  if (typeof scoped !== 'object' || Array.isArray(scoped)) {
    throw new Error(`unsupported scoped @context: ${term}`)
  }
  return scoped as Record<string, JsonLdValue>
}

const SUPPORTED_KEYWORDS = new Set(['@context', '@id', '@type'])

function rejectUnsupportedKeywords(node: Record<string, JsonLdValue>): void {
  for (const key of Object.keys(node)) {
    if (key.startsWith('@') && !SUPPORTED_KEYWORDS.has(key)) {
      throw new Error(`unsupported JSON-LD keyword: ${key}`)
    }
  }
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
  const lines = quads.map((q) => ({
    canonical: serializeQuad(q, labels),
    quad: q,
  }))
  lines.sort((a, b) => (a.canonical < b.canonical ? -1
    : a.canonical > b.canonical ? 1 : 0))
  if (!labelMap) return lines.map((l) => l.canonical)
  return lines.map((l) => serializeQuad(l.quad, labels, labelMap))
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
  const ids = collectBlankIds(quads)
  const labels = new Map<string, string>()
  if (ids.length === 0) return labels

  const hashed: Array<{ id: string, hash: string }> = []
  for (const id of ids) {
    hashed.push({ id, hash: await firstDegreeHash(id, quads) })
  }
  hashed.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
  for (let i = 0; i < hashed.length; i++) {
    if (i > 0 && hashed[i].hash === hashed[i - 1].hash) {
      throw new Error('ambiguous blank nodes: n-degree hashing unsupported')
    }
    labels.set(hashed[i].id, `_:c14n${i}`)
  }
  return labels
}

function collectBlankIds(quads: readonly Quad[]): string[] {
  const seen = new Set<string>()
  for (const q of quads) {
    for (const t of [q.subject, q.object]) {
      if (t.kind === 'blank') seen.add(t.value)
    }
  }
  return [...seen]
}

// URDNA2015 first-degree hash (§4.6): serialize every
// quad the node appears in, with the node itself written
// as '_:a' and any other blank node as '_:z', sort, hash.
async function firstDegreeHash(
  id: string, quads: readonly Quad[],
): Promise<string> {
  const related = quads.filter(
    (q) => q.subject.value === id || q.object.value === id,
  )
  const lines = related.map((q) => serializeQuad(q, undefined, undefined, {
    self: id,
  }))
  lines.sort()
  const digest = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(lines.join('')),
  )
  return hex(new Uint8Array(digest))
}

interface FirstDegree {
  readonly self: string
}

function serializeQuad(
  quad: Quad,
  labels?: ReadonlyMap<string, string>,
  labelMap?: ReadonlyMap<string, string>,
  fd?: FirstDegree,
): string {
  const s = serializeTerm(quad.subject, labels, labelMap, fd)
  const p = serializeTerm(quad.predicate, labels, labelMap, fd)
  const o = serializeTerm(quad.object, labels, labelMap, fd)
  return `${s} ${p} ${o} .\n`
}

function serializeTerm(
  term: Term,
  labels?: ReadonlyMap<string, string>,
  labelMap?: ReadonlyMap<string, string>,
  fd?: FirstDegree,
): string {
  if (term.kind === 'iri') return `<${term.value}>`
  if (term.kind === 'blank') {
    if (fd) return term.value === fd.self ? '_:a' : '_:z'
    const canonical = labels?.get(term.value) ?? term.value
    if (labelMap) {
      const mapped = labelMap.get(stripBlank(canonical))
      if (mapped === undefined) {
        throw new Error(`label map has no entry for ${canonical}`)
      }
      return `_:${mapped}`
    }
    return canonical
  }
  return serializeLiteral(term)
}

function serializeLiteral(term: Term & { kind: 'literal' }): string {
  const lex = `"${escapeLiteral(term.value)}"`
  if (term.language !== undefined) return `${lex}@${term.language}`
  if (term.datatype === XSD_STRING) return lex
  return `${lex}^^<${term.datatype}>`
}

function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

function stripBlank(label: string): string {
  return label.startsWith('_:') ? label.slice(2) : label
}

function hex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}
