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
 *     term -> IRI, or term -> { @id, @type?, @language? };
 *   - nodes identified by an explicit @id (IRI, our docs
 *     carry one on every node), @type as a CURIE/IRI or an
 *     array of them, nested nodes, and arrays of values;
 *   - literals: plain strings (xsd:string), @language
 *     strings, @type-coerced typed literals, integers
 *     (xsd:integer), and booleans (xsd:boolean).
 *
 * Rejected (fail closed): named graphs, @list / @set /
 * @reverse / @included / @nest, remote or nested
 * contexts, non-integer JSON numbers (their RDF datatype
 * is ambiguous - typed decimals must arrive as a string
 * plus a datatype), and any blank-node graph whose nodes
 * do not separate under first-degree hashing.
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
  readonly type?: string
  readonly language?: string
}

interface Context {
  readonly terms: ReadonlyMap<string, TermDef>
  readonly prefixes: ReadonlyMap<string, string>
  // Keyword aliases: a term mapped to '@id' or '@type'.
  // Data Integrity proof blocks alias 'type' to '@type',
  // so canonicalizing proof options needs this.
  readonly aliases: ReadonlyMap<string, string>
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
  const state: WalkState = { context, quads, nextBlank: 0 }
  walkNode(document, state)
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
  readonly context: Context
  readonly quads: Quad[]
  nextBlank: number
}

// Emit the quads for one node and return the RDF term
// that stands for it (its @id IRI, or a fresh blank node).
function walkNode(
  rawNode: Record<string, JsonLdValue>, state: WalkState,
): Term {
  const node = normalizeKeywords(rawNode, state.context)
  rejectUnsupportedKeywords(node)
  const subject = nodeSubject(node, state)

  if ('@type' in node) {
    for (const t of asArray(node['@type'])) {
      if (typeof t !== 'string') throw new Error('@type must be a string')
      state.quads.push({
        subject,
        predicate: { kind: 'iri', value: RDF_TYPE },
        object: { kind: 'iri', value: expandIri(t, state.context, true) },
      })
    }
  }

  for (const [term, raw] of Object.entries(node)) {
    if (term.startsWith('@')) continue
    // A defined term carries its IRI (and any coercion); an
    // undefined term expands through @vocab, or is rejected
    // when no vocabulary grounds it.
    const def = state.context.terms.get(term)
    const predicate: Term = {
      kind: 'iri', value: def ? def.id : expandIri(term, state.context, true),
    }
    for (const value of asArray(raw)) {
      state.quads.push({
        subject, predicate, object: toObject(value, def, state),
      })
    }
  }
  return subject
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
  node: Record<string, JsonLdValue>, state: WalkState,
): Term {
  const id = node['@id']
  if (id === undefined) {
    return { kind: 'blank', value: `_:b${state.nextBlank++}` }
  }
  if (typeof id !== 'string') throw new Error('@id must be a string')
  if (id.startsWith('_:')) return { kind: 'blank', value: id }
  return { kind: 'iri', value: expandIri(id, state.context, false) }
}

// Resolve a term value to an RDF object term. A nested
// object is either a value object ({ @value, ... }) or a
// node (recurse); a @type:@id coercion makes a string an
// IRI; a datatype coercion types a literal; otherwise the
// JSON type decides.
function toObject(
  value: JsonLdValue, def: TermDef | undefined, state: WalkState,
): Term {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, JsonLdValue>
    if ('@value' in obj) return valueObject(obj, def, state.context)
    return walkNode(obj, state)
  }
  // @id-coerced values expand as document IRIs; @vocab-coerced
  // ones through the vocabulary. Everything else is a literal.
  if (def?.type === '@id' || def?.type === '@vocab') {
    if (typeof value !== 'string') throw new Error('IRI value must be a string')
    return { kind: 'iri', value: expandIri(value, state.context, def.type === '@vocab') }
  }
  return scalarLiteral(value, def, state.context)
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
  return scalarLiteral(value, def, context)
}

function scalarLiteral(
  value: JsonLdValue, def: TermDef | undefined, context: Context,
): Term {
  if (def?.type && def.type !== '@id' && def.type !== '@vocab') {
    return literal(String(value), expandIri(def.type, context, true))
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
// colon with an undefined prefix is already an absolute IRI
// (https:, did:, urn:, and an xsd: whose prefix the context
// leaves undefined) and passes through. A bare word expands
// through the term map then @vocab in vocab position (a
// predicate, a @type, a @vocab-coerced value); in @id
// position it is a document reference and passes through.
function expandIri(value: string, context: Context, vocab: boolean): string {
  const colon = value.indexOf(':')
  if (colon > 0) {
    const prefix = value.slice(0, colon)
    const base = context.prefixes.get(prefix)
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
  const terms = new Map<string, TermDef>()
  const prefixes = new Map<string, string>()
  const aliases = new Map<string, string>()
  let vocab: string | undefined
  for (const entry of asArray(raw)) {
    const map = resolveContextEntry(entry, registry)
    if (!map) continue
    for (const [term, def] of Object.entries(map)) {
      if (term === '@vocab') {
        if (typeof def === 'string') vocab = def
      } else {
        addContextTerm(term, def, terms, prefixes, aliases)
      }
    }
  }
  return { terms, prefixes, aliases, vocab }
}

// A context entry is either an inline term map or a URL
// resolved from the offline registry to its document
// (`{ @context: ... }` or a bare map). An unresolvable URL
// contributes nothing rather than reaching the network.
function resolveContextEntry(
  entry: JsonLdValue, registry?: Readonly<Record<string, JsonLdValue>>,
): Record<string, JsonLdValue> | undefined {
  if (typeof entry === 'string') {
    const doc = registry?.[entry]
    if (doc === undefined) return undefined
    const inner = (doc as Record<string, JsonLdValue>)['@context'] ?? doc
    return inner as Record<string, JsonLdValue>
  }
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('unsupported @context entry')
  }
  return entry as Record<string, JsonLdValue>
}

function addContextTerm(
  term: string,
  def: JsonLdValue,
  terms: Map<string, TermDef>,
  prefixes: Map<string, string>,
  aliases: Map<string, string>,
): void {
  if (term.startsWith('@')) return
  if (def === '@id' || def === '@type') {
    aliases.set(term, def)
    return
  }
  if (typeof def === 'string') {
    // A term may map to a CURIE against a prefix defined
    // earlier in the same context; resolve it now. Every
    // term doubles as a usable prefix, per JSON-LD compact
    // IRI expansion.
    const id = resolvePrefixed(def, prefixes)
    prefixes.set(term, id)
    terms.set(term, { id })
    return
  }
  if (def === null || typeof def !== 'object' || Array.isArray(def)) {
    throw new Error(`unsupported @context term: ${term}`)
  }
  const obj = def as Record<string, JsonLdValue>
  const id = obj['@id']
  if (typeof id !== 'string') {
    throw new Error(`@context term without @id: ${term}`)
  }
  terms.set(term, {
    id: resolvePrefixed(id, prefixes),
    type: typeof obj['@type'] === 'string' ? obj['@type'] : undefined,
    language:
      typeof obj['@language'] === 'string' ? obj['@language'] : undefined,
  })
}

// A term's @id may itself be a CURIE against a prefix
// defined earlier in the same context.
function resolvePrefixed(
  id: string, prefixes: ReadonlyMap<string, string>,
): string {
  const colon = id.indexOf(':')
  if (colon > 0 && !id.includes('://')) {
    const base = prefixes.get(id.slice(0, colon))
    if (base) return base + id.slice(colon + 1)
  }
  return id
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
