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
      .rejects.toThrow(/non-integer JSON number/);
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
});
