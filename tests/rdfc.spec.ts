/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Canonicalizer coverage for src/crypto/rdfc.ts. Expected
 * N-Quads are hand-derived (not produced by the code under
 * test) so the assertions are an independent check of the
 * JSON-LD -> RDF mapping, the literal/datatype/language
 * serialization, blank-node c14n labelling, the canonical
 * sort, and the derived-proof label-replacement variant.
 */

import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/crypto/rdfc';

const RDF_TYPE =
  '<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>';
const CTX = {
  ex: 'http://example.org/',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
};

describe('canonicalize: basic node with type and string', () => {
  it('emits sorted N-Quads for an IRI subject', async () => {
    const doc = {
      '@context': { ...CTX, name: 'ex:name' },
      '@id': 'ex:s1',
      '@type': 'ex:Thing',
      name: 'Alice',
    };
    // Predicate <.../name> sorts before <...#type> ('e' < 'w').
    // A plain string is an xsd:string, emitted without ^^.
    expect(await canonicalize(doc)).toEqual([
      '<http://example.org/s1> <http://example.org/name> "Alice" .\n',
      `<http://example.org/s1> ${RDF_TYPE} <http://example.org/Thing> .\n`,
    ]);
  });
});

describe('canonicalize: typed literals', () => {
  it('coerces datatype, integers, booleans, language tags', async () => {
    const doc = {
      '@context': {
        ...CTX,
        cap: { '@id': 'ex:cap', '@type': 'xsd:decimal' },
        count: 'ex:count',
        active: 'ex:active',
        label: { '@id': 'ex:label', '@language': 'en' },
      },
      '@id': 'ex:s',
      cap: '2.0',
      count: 5,
      active: true,
      label: 'Hello',
    };
    const lines = await canonicalize(doc);
    expect(lines).toContain(
      '<http://example.org/s> <http://example.org/cap> '
      + '"2.0"^^<http://www.w3.org/2001/XMLSchema#decimal> .\n',
    );
    expect(lines).toContain(
      '<http://example.org/s> <http://example.org/count> '
      + '"5"^^<http://www.w3.org/2001/XMLSchema#integer> .\n',
    );
    expect(lines).toContain(
      '<http://example.org/s> <http://example.org/active> '
      + '"true"^^<http://www.w3.org/2001/XMLSchema#boolean> .\n',
    );
    expect(lines).toContain(
      '<http://example.org/s> <http://example.org/label> "Hello"@en .\n',
    );
  });
});

// A value's datatype is written as an absolute IRI, and
// these cases are the reason. A compact one reads two ways:
// this canonicalizer expands it against any prefix the
// context defines, while a processor applying JSON-LD 1.1's
// prefix rule leaves it standing, since a simple term
// definition only acts as a prefix when its IRI ends in a
// gen-delim character. The two readings produce different
// statements out of identical bytes, which breaks the
// signature rather than the render. An absolute IRI has
// nothing left to expand, so every reader agrees.
describe('canonicalize: value datatypes', () => {
  const ABSOLUTE =
    'https://transpareo.com/vocab/transpareo/v1#iso3166-1-alpha2';
  const doc = (datatype: string, context: Record<string, unknown> = {}) => ({
    '@context': { ...CTX, origin: 'ex:origin', ...context },
    '@id': 'ex:s',
    origin: { '@value': 'PT', '@type': datatype },
  });
  const quad = (datatype: string) =>
    `<http://example.org/s> <http://example.org/origin> `
    + `"PT"^^<${datatype}> .\n`;

  it('carries an absolute datatype through untouched', async () => {
    expect(await canonicalize(doc(ABSOLUTE))).toEqual([quad(ABSOLUTE)]);
  });

  // The same document, with and without a context that
  // could act on the datatype: an absolute IRI is inert
  // either way, which is the property the wire relies on.
  it('reads an absolute datatype the same with or without a prefix',
    async () => {
      const withPrefix = await canonicalize(doc(ABSOLUTE, {
        'iso3166-1': 'https://transpareo.com/vocab/transpareo/v1#iso3166-1-',
      }));
      expect(withPrefix).toEqual(await canonicalize(doc(ABSOLUTE)));
    });

  it('expands a compact datatype against a defined prefix', async () => {
    const lines = await canonicalize(doc('iso3166-1:alpha2', {
      'iso3166-1': 'https://transpareo.com/vocab/transpareo/v1#iso3166-1-',
    }));
    expect(lines).toEqual([quad(ABSOLUTE)]);
  });

  it('leaves a compact datatype standing when no prefix defines it',
    async () => {
      const lines = await canonicalize(doc('iso3166-1:alpha2'));
      expect(lines).toEqual([quad('iso3166-1:alpha2')]);
    });
});

describe('canonicalize: IRI references and nested nodes', () => {
  it('coerces @type:@id and recurses into nested nodes', async () => {
    const doc = {
      '@context': {
        ...CTX,
        child: 'ex:child',
        ref: { '@id': 'ex:ref', '@type': '@id' },
        name: 'ex:name',
      },
      '@id': 'ex:parent',
      ref: 'ex:target',
      child: { '@id': 'ex:kid', name: 'Kid' },
    };
    // Subjects sort first: <.../kid> precedes <.../parent>
    // ('k' < 'p'). Within the parent subject, predicate
    // <.../child> precedes <.../ref> ('c' < 'r').
    expect(await canonicalize(doc)).toEqual([
      '<http://example.org/kid> <http://example.org/name> "Kid" .\n',
      '<http://example.org/parent> <http://example.org/child> '
      + '<http://example.org/kid> .\n',
      '<http://example.org/parent> <http://example.org/ref> '
      + '<http://example.org/target> .\n',
    ]);
  });
});

describe('canonicalize: multi-valued terms', () => {
  it('emits one quad per array element', async () => {
    const doc = {
      '@context': { ...CTX, tag: 'ex:tag' },
      '@id': 'ex:s',
      tag: ['a', 'b'],
    };
    expect(await canonicalize(doc)).toEqual([
      '<http://example.org/s> <http://example.org/tag> "a" .\n',
      '<http://example.org/s> <http://example.org/tag> "b" .\n',
    ]);
  });
});

describe('canonicalize: blank node (proof-options shape)', () => {
  const proof = {
    '@context': { ...CTX, created: 'ex:created', vm: 'ex:vm' },
    '@type': 'ex:Proof',
    created: '2026-07-17',
    vm: 'key1',
  };

  it('labels the single blank node c14n0 and sorts', async () => {
    expect(await canonicalize(proof)).toEqual([
      '_:c14n0 <http://example.org/created> "2026-07-17" .\n',
      '_:c14n0 <http://example.org/vm> "key1" .\n',
      `_:c14n0 ${RDF_TYPE} <http://example.org/Proof> .\n`,
    ]);
  });

  it('replaces the c14n label from a labelMap, keeping order', async () => {
    const map = new Map([['c14n0', 'HMAC0']]);
    expect(await canonicalize(proof, { labelMap: map })).toEqual([
      '_:HMAC0 <http://example.org/created> "2026-07-17" .\n',
      '_:HMAC0 <http://example.org/vm> "key1" .\n',
      `_:HMAC0 ${RDF_TYPE} <http://example.org/Proof> .\n`,
    ]);
  });

  // The two nodes tie under first-degree hashing. A literal
  // spelling one's label is no quad of that node, so it must
  // not break the tie; read as one, it labelled the pair in an
  // order RDFC-1.0 never gives.
  it('leaves a literal spelling a blank label out of its hash', async () => {
    const doc = {
      '@context': { ...CTX, p: 'ex:p', name: 'ex:name', note: 'ex:note' },
      '@id': 'ex:s',
      p: [{ name: 'x' }, { name: 'x' }],
      note: '_:b1',
    };
    await expect(canonicalize(doc))
      .rejects.toThrow('ambiguous blank nodes');
  });
});

// RDFC-1.0 sorts by Unicode code point, and so does the issuer
// (Ruby compares UTF-8 bytes). UTF-16 code units put a
// character above U+FFFF, a surrogate pair, before one from
// U+E000 to U+FFFF.
describe('canonicalize: code point order', () => {
  const ASTRAL = '\u{1f600}';
  const S = '<http://example.org/s>';
  const NOTE = '<http://example.org/note>';
  const note = (values: string[]) => ({
    '@context': { ...CTX, note: 'ex:note' }, '@id': 'ex:s', note: values,
  });

  it.each([
    ['U+E000', '\ue000'],
    ['a fullwidth form', '\uff08'],
    ['U+FFFD', '\ufffd'],
    ['U+D7FF', '\ud7ff'],
    ['a lower astral character', '\u{1f5ff}'],
    ['the end of the value', ''],
  ])('sorts %s before an astral character', async (_label, char) => {
    expect(await canonicalize(note([`a${ASTRAL}`, `a${char}`]))).toEqual([
      `${S} ${NOTE} "a${char}" .\n`,
      `${S} ${NOTE} "a${ASTRAL}" .\n`,
    ]);
  });

  const scoped = (id: string, v: string) => ({ '@id': id, '@context': { v } });

  // The astral type name, or the astral key, sorts last by code
  // point, so A's context applies last and its `v` holds.
  it.each([
    ['type names', {
      [`T${ASTRAL}`]: scoped('ex:A', 'ex:a'),
      'T\ue000': scoped('ex:B', 'ex:b'),
    }, { '@type': [`T${ASTRAL}`, 'T\ue000'] }],
    ['type keys', {
      [`k${ASTRAL}`]: '@type', 'k\ue000': '@type',
      A: scoped('ex:A', 'ex:a'), B: scoped('ex:B', 'ex:b'),
    }, { [`k${ASTRAL}`]: 'A', 'k\ue000': 'B' }],
  ])('orders type-scoped contexts by %s', async (_label, terms, types) => {
    const doc = {
      '@context': { ...CTX, ...terms }, '@id': 'ex:s', ...types, v: 'x',
    };
    expect(await canonicalize(doc)).toEqual([
      `${S} <http://example.org/a> "x" .\n`,
      `${S} ${RDF_TYPE} <http://example.org/A> .\n`,
      `${S} ${RDF_TYPE} <http://example.org/B> .\n`,
    ]);
  });

  // SHA-256 over each blank node's lines in code point order:
  // the node with two notes hashes to e4c913e1..., the one
  // with "a" to 55e44cde... and takes c14n0. In UTF-16 order
  // the two notes swap and hash to 3fadb6bb..., which would
  // hand c14n0 to the other node.
  it('hashes a blank node over its lines in code point order', async () => {
    const doc = {
      '@context': { ...CTX, p: 'ex:p', note: 'ex:note' },
      '@id': 'ex:s',
      p: [{ note: [ASTRAL, '\ue000'] }, { note: 'a' }],
    };
    const p = `${S} <http://example.org/p>`;
    expect(await canonicalize(doc)).toEqual([
      `${p} _:c14n0 .\n`,
      `${p} _:c14n1 .\n`,
      `_:c14n0 ${NOTE} "a" .\n`,
      `_:c14n1 ${NOTE} "\ue000" .\n`,
      `_:c14n1 ${NOTE} "${ASTRAL}" .\n`,
    ]);
  });
});

describe('canonicalize: literal escaping', () => {
  it('escapes quotes, backslashes, and control characters', async () => {
    const doc = {
      '@context': { ...CTX, note: 'ex:note' },
      '@id': 'ex:s',
      note: 'a"b\\c\nd',
    };
    expect(await canonicalize(doc)).toEqual([
      '<http://example.org/s> <http://example.org/note> '
      + '"a\\"b\\\\c\\nd" .\n',
    ]);
  });

  // Canonical N-Quads (RDFC-1.0 Appendix A), as the issuer's
  // RDF::NTriples::Writer.escape writes it: BS, HT, LF, FF,
  // CR, quote and backslash as ECHAR; the other C0 controls,
  // DEL and what XML 1.1 Char leaves out (U+0000, a lone
  // surrogate, U+FFFE, U+FFFF) as \u with four uppercase hex
  // digits.
  const note = (value: unknown) => ({
    '@context': { ...CTX, note: 'ex:note' }, '@id': 'ex:s', note: value,
  });
  const noted = (object: string) =>
    `<http://example.org/s> <http://example.org/note> ${object} .\n`;

  it.each([
    ['backspace', '\b', '\\b'],
    ['a tab', '\t', '\\t'],
    ['a form feed', '\f', '\\f'],
    ['a carriage return', '\r', '\\r'],
    ['U+0000', '\u0000', '\\u0000'],
    ['U+0001', '\u0001', '\\u0001'],
    ['a vertical tab, hex in upper case', '\u000b', '\\u000B'],
    ['U+001F', '\u001f', '\\u001F'],
    ['DEL', '\u007f', '\\u007F'],
    ['U+FFFE', '\ufffe', '\\uFFFE'],
    ['U+FFFF', '\uffff', '\\uFFFF'],
    ['a lone high surrogate', '\ud800', '\\uD800'],
    ['a lone low surrogate', '\udfff', '\\uDFFF'],
  ])('escapes %s', async (_label, char, escaped) => {
    expect(await canonicalize(note(`a${char}b`)))
      .toEqual([noted(`"a${escaped}b"`)]);
  });

  it.each([
    ['a space', ' '],
    ['a tilde', '~'],
    ['an apostrophe', "'"],
    ['U+0080', '\u0080'],
    ['U+009F', '\u009f'],
    ['a no-break space', '\u00a0'],
    ['an umlaut', '\u00e4'],
    ['U+D7FF', '\ud7ff'],
    ['U+E000', '\ue000'],
    ['U+FFFD', '\ufffd'],
    ['an astral emoji', '\u{1f600}'],
  ])('writes %s as it stands', async (_label, char) => {
    expect(await canonicalize(note(`a${char}b`)))
      .toEqual([noted(`"a${char}b"`)]);
  });

  it('escapes a language-tagged and a typed literal alike', async () => {
    const tagged = { '@value': '\u0001\f', '@language': 'en' };
    const typed = { '@value': '\u0001\f', '@type': 'ex:code' };
    expect(await canonicalize(note([tagged, typed]))).toEqual([
      noted('"\\u0001\\f"@en'),
      noted('"\\u0001\\f"^^<http://example.org/code>'),
    ]);
  });
});

// JSON.parse keeps a "__proto__" key as an own property, and a
// JSON-LD processor reads it as a term like any other. Read
// through an alias, it must still come out a statement, so no
// key a signature leaves out hides under the name.
describe('canonicalize: a __proto__ key', () => {
  const parsed = (value: string) => JSON.parse(`{
    "@context": { "ex": "http://example.org/", "id": "@id",
      "@vocab": "http://example.org/v#" },
    "id": "ex:s",
    "__proto__": ${value}
  }`);
  const proto = '<http://example.org/s> <http://example.org/v#__proto__>';

  it.each([
    ['a string', '"x"', '"x"'],
    ['a node', '{ "id": "ex:o" }', '<http://example.org/o>'],
  ])('reads one holding %s as a term', async (_label, value, object) => {
    expect(await canonicalize(parsed(value)))
      .toEqual([`${proto} ${object} .\n`]);
  });
});

describe('canonicalize: fails closed on out-of-scope input', () => {
  it('rejects an unmapped term', async () => {
    const doc = { '@context': CTX, '@id': 'ex:s', mystery: 'x' };
    await expect(canonicalize(doc)).rejects.toThrow(/cannot expand term/);
  });

  it('rejects a non-integer JSON number', async () => {
    const doc = {
      '@context': { ...CTX, n: 'ex:n' }, '@id': 'ex:s', n: 2.5,
    };
    await expect(canonicalize(doc))
      .rejects.toThrow('unsupported literal value: 2.5');
  });

  it('rejects an unsupported keyword like @list', async () => {
    const doc = {
      '@context': { ...CTX, vals: 'ex:vals' },
      '@id': 'ex:s',
      vals: { '@list': ['a', 'b'] },
    };
    await expect(canonicalize(doc))
      .rejects.toThrow(/unsupported JSON-LD keyword/);
  });

  // A context entry yields no statement of its own, so one
  // read as absent leaves the N-Quads, and a signature over
  // them, unchanged while a JSON-LD processor reads its terms.
  it('rejects a context URL the registry does not hold', async () => {
    const doc = {
      '@context': ['https://example.org/extra', { ...CTX, name: 'ex:name' }],
      '@id': 'ex:s',
      name: 'Alice',
    };
    const contexts = { 'https://example.org/known': { '@context': CTX } };
    await expect(canonicalize(doc, { contexts }))
      .rejects.toThrow('cannot resolve @context: https://example.org/extra');
    await expect(canonicalize(doc))
      .rejects.toThrow(/cannot resolve @context/);
  });

  it('resolves a URL through the registry entries only', async () => {
    const doc = {
      '@context': ['constructor', { ...CTX, name: 'ex:name' }],
      '@id': 'ex:s',
      name: 'Alice',
    };
    await expect(canonicalize(doc, { contexts: {} }))
      .rejects.toThrow('cannot resolve @context: constructor');
  });

  it('rejects a registered context that lists further contexts', async () => {
    const doc = {
      '@context': ['https://example.org/known', { ...CTX, name: 'ex:name' }],
      '@id': 'ex:s',
      name: 'Alice',
    };
    const contexts = {
      'https://example.org/known': { '@context': ['https://example.org/x'] },
    };
    await expect(canonicalize(doc, { contexts }))
      .rejects.toThrow(/unsupported @context entry/);
  });

  it('rejects a @context on a nested node', async () => {
    const doc = {
      '@context': { ...CTX, name: 'ex:name', knows: 'ex:knows' },
      '@id': 'ex:s',
      knows: {
        '@context': { name: 'ex:alias' }, '@id': 'ex:o', name: 'Bob',
      },
    };
    await expect(canonicalize(doc))
      .rejects.toThrow(/unsupported nested @context/);
  });
});
