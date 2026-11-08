/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import {
  mkdtempSync, readFileSync, readdirSync, existsSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildEcdsaSdIssuer } from '../scripts/seed/ecdsa-sd-signing';
import { buildSnapshots, type ImageMap } from '../scripts/seed/emit-artefacts';
import { FixtureSchema, type Fixture } from '../scripts/seed/schema';
import { verifyDpp, dppIsAuthentic } from '../src/crypto/dispatch';
import { decodeMultibaseBase58 } from '../src/crypto/multibase';
import {
  TRANSPAREO_V2_CONTEXT_URL, VC_CONTEXT_URL,
} from '../src/crypto/dpp-contexts';
import type { ResolvedMultikey } from '../src/crypto/did-web';

const DOCUMENT_TYPE =
  'https://transpareo.com/vocab/transpareo/v2#document-type';

// Resolve each proof's key from the emitted Multikey doc: the
// platform proof verifies against platform-p256.json, every
// other against issuer-p256.json.
function keyResolver(
  keysDir: string,
): (m: string) => Promise<ResolvedMultikey> {
  const load = (fileName: string): ResolvedMultikey => {
    const multibase = (JSON.parse(
      readFileSync(join(keysDir, fileName), 'utf8'),
    ) as { publicKeyMultibase: string }).publicKeyMultibase;
    return { multibase, bytes: decodeMultibaseBase58(multibase) };
  };
  return (method: string): Promise<ResolvedMultikey> => Promise.resolve(
    method.endsWith('platform-p256.json')
      ? load('platform-p256.json') : load('issuer-p256.json'),
  );
}

// Each issuer writes its key documents into a directory of its
// own, which the verifier reads back; all of them go once the
// file's tests are done.
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sd-'));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('seed ecdsa-sd issuer', () => {
  it('issues a VC with two proofs the verifier accepts', async () => {
    const dir = tempDir();
    const issuer = await buildEcdsaSdIssuer(
      dir, 'acme', 'abc12345', '2026-05-01T12:00:00Z',
      'did:web:acme.example', 'did:web:platform.example',
    );
    const body = {
      '@context': ['ignored'],
      '@type': 'dpp:DigitalProductPassport',
      '@id': 'https://acme.example/dpp/abc12345',
      passportAlias: 'abc12345',
      version: 1,
      product: {
        '@type': 'Product',
        name: 'Pulse 2000',
        properties: [
          {
            '@type': 'PropertyValue', propertyID: 'capacity',
            name: 'Capacity', value: '2.0',
          },
        ],
      },
    };
    const vc = await issuer.issue(body);
    expect((vc.proof as unknown[]).length).toBe(2);
    const v = await verifyDpp(vc, {
      resolveIssuerKey: keyResolver(join(dir, 'acme/dpp/abc12345/keys')),
    });
    expect(v.cryptosuite).toBe('ecdsa-sd-2023');
    expect(dppIsAuthentic(v)).toBe(true);
  });

  // A passport published today names the v2 edition, which
  // defines the download terms.
  it('issues a v2 credential with a download the verifier accepts', async () => {
    const dir = tempDir();
    const issuer = await buildEcdsaSdIssuer(
      dir, 'acme', 'abc12345', '2026-05-01T12:00:00Z',
      'did:web:acme.example', 'did:web:platform.example',
    );
    const download = {
      '@type': 'Link',
      href: '/media/acme/files/9f86d081.pdf',
      mediaType: 'application/pdf',
      fileDigest: 'sha256-n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V1sFbDwCgg=',
      name: [
        { '@value': 'Prüfbericht', '@language': 'de' },
        { '@value': 'Test report', '@language': 'en' },
      ],
      fileLanguages: ['de'],
      documentType: { '@value': 'test_report', '@type': DOCUMENT_TYPE },
      documentIssuer: 'Hohenstein Institute',
      documentNumber: 'HS-2026-0412',
      documentValidFrom: '2026-01-01',
      documentValidUntil: '2028-12-31',
      fileVersions: [{
        '@type': 'Link',
        href: '/media/acme/files/60303ae2.pdf',
        mediaType: 'application/pdf',
        fileDigest: 'sha256-YDA64iuZiGMqUIwKmMDLYyFqBnnSZrAFBYxDGSnrUEg=',
        fileLanguages: ['en'],
      }],
    };
    const vc = await issuer.issue({
      '@context': ['ignored'],
      '@type': 'dpp:DigitalProductPassport',
      '@id': 'https://acme.example/dpp/abc12345',
      passportAlias: 'abc12345',
      version: 1,
      product: { '@type': 'Product', name: 'Pulse 2000', downloads: [download] },
    });
    const v = await verifyDpp(vc, {
      resolveIssuerKey: keyResolver(join(dir, 'acme/dpp/abc12345/keys')),
    });

    expect(vc['@context']).toEqual([VC_CONTEXT_URL, TRANSPAREO_V2_CONTEXT_URL]);
    expect(dppIsAuthentic(v)).toBe(true);
  });
});

type Json = Record<string, unknown>;

const PAGE = 'https://acme.example/dpp/abc12345';

// A credential over a passport whose product carries `fields`,
// issued by the seed under scratch keys.
async function issueProduct(
  fields: Json,
): Promise<{ vc: Json; keysDir: string }> {
  const dir = tempDir();
  const issuer = await buildEcdsaSdIssuer(
    dir, 'acme', 'abc12345', '2026-05-01T12:00:00Z',
    'did:web:acme.example', 'did:web:platform.example',
  );
  const vc = await issuer.issue({
    '@id': PAGE,
    passportAlias: 'abc12345',
    version: 1,
    product: { '@type': 'Product', name: 'Pulse 2000', ...fields },
  });
  return { vc, keysDir: join(dir, 'acme/dpp/abc12345/keys') };
}

const row = (propertyID: string, value: unknown): Json => ({
  '@type': 'PropertyValue', propertyID, name: propertyID, value,
});

const productOf = (vc: Json): Json =>
  (vc.credentialSubject as Json).product as Json;

const idsOf = (nodes: unknown): unknown[] =>
  (nodes as Json[]).map((node) => node['@id']);

// The platform's issuer suffixes list members that land on one
// fragment with their position in the list, so no two members
// of a list share an @id; the seed issues the same ids for the
// same passport.
describe('seed ecdsa-sd ids', () => {
  it('suffixes the rows whose propertyIDs slug alike', async () => {
    const { vc, keysDir } = await issueProduct({
      properties: [
        row('carbon_footprint', '71'),
        row('capacity', '2.0'),
        row('carbon-footprint', '64'),
      ],
    });
    const v = await verifyDpp(vc, { resolveIssuerKey: keyResolver(keysDir) });

    expect(idsOf(productOf(vc).properties)).toEqual([
      `${PAGE}#property/carbon-footprint/0`,
      `${PAGE}#property/capacity`,
      `${PAGE}#property/carbon-footprint/2`,
    ]);
    expect(dppIsAuthentic(v)).toBe(true);
  });

  it('suffixes the rows of one multi-valued property', async () => {
    const { vc } = await issueProduct({
      properties: ['S', 'M', 'L'].map((size) => row('sizes', size)),
    });

    expect(idsOf(productOf(vc).properties)).toEqual([
      `${PAGE}#property/sizes/0`,
      `${PAGE}#property/sizes/1`,
      `${PAGE}#property/sizes/2`,
    ]);
  });

  it('names the nodes under a suffixed row from its fragment', async () => {
    const stage = (name: string): Json => ({
      '@type': 'Substance', name, value: '12', unitCode: 'P1',
    });
    const { vc } = await issueProduct({
      properties: [
        row('carbon_footprint', '71'),
        row('carbon-footprint', [stage('Materials'), stage('Assembly')]),
      ],
    });
    const stages = (productOf(vc).properties as Json[])[1].value;

    expect(idsOf(stages)).toEqual([
      `${PAGE}#property/carbon-footprint/1/value/0`,
      `${PAGE}#property/carbon-footprint/1/value/1`,
    ]);
  });

  // A block outside a list can name a propertyID (the
  // platform's restricted manufacturer does), which a row of
  // the same term shares.
  it('names a block outside a list by its place in the product', async () => {
    const { vc } = await issueProduct({
      manufacturer: {
        '@type': 'Organization', propertyID: 'manufacturer',
        name: 'Volturra Energia',
      },
      properties: [row('manufacturer', 'Volturra')],
    });
    const product = productOf(vc);

    expect((product.manufacturer as Json)['@id'])
      .toBe(`${PAGE}#product/manufacturer`);
    expect(idsOf(product.properties))
      .toEqual([`${PAGE}#property/manufacturer`]);
  });
});

const FIXTURES = new URL('../fixtures/', import.meta.url);

// Every fixture the seed signs as ecdsa-sd credentials.
const ecdsaFixtures = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.yml'))
  .map((file) => readFileSync(new URL(file, FIXTURES), 'utf8'))
  .map((yaml) => FixtureSchema.parse(parse(yaml)))
  .filter((fixture) => fixture.proof_suite === 'ecdsa-sd-2023');

// One path per image key, in the shape the seed serves them
// under; nothing below reads an image.
function imagesOf(fixture: Fixture): ImageMap {
  const base = `/fixtures/${fixture.id}`;
  return Object.fromEntries(Object.keys(fixture.images).map((key) => [key, {
    thumbnail: `${base}/${key}-thumbnail.jpg`,
    large: `${base}/${key}-large.jpg`,
  }]));
}

const isNode = (value: unknown): value is Json => value !== null
  && typeof value === 'object' && !Array.isArray(value)
  && !('@value' in value);

const unsecured = (vc: Json): Json => {
  const { proof: _proof, ...rest } = vc;
  return rest;
};

// Every @id the credential names, nested nodes included.
function nodeIdsOf(value: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) nodeIdsOf(item, out);
  } else if (isNode(value)) {
    if ('@id' in value) out.push(value['@id']);
    for (const item of Object.values(value)) nodeIdsOf(item, out);
  }
  return out;
}

// The statements the platform's issuer reads off a credential
// before it signs (`EcdsaSd.each_statement`): `subject key
// object` per value, descending into nested nodes. Issuance
// refuses a credential that yields one twice.
function statementsOf(node: Json, out: string[] = []): string[] {
  for (const [key, value] of Object.entries(node)) {
    if (key === '@id' || key === '@context') continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      out.push(`${String(node['@id'])} ${key} ${statementObject(item)}`);
      if (isNode(item)) statementsOf(item, out);
    }
  }
  return out;
}

// A node stands for its @id, a value object for its pairs in
// key order, anything else for its JSON.
function statementObject(value: unknown): string {
  if (isNode(value)) return String(value['@id']);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const pairs = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify(pairs);
}

const repeatsOf = <T>(items: T[]): T[] =>
  items.filter((item, index) => items.indexOf(item) !== index);

// Every version of every ecdsa-sd fixture, built and issued in
// memory as `npm run seed` builds and issues them, with the key
// documents in a scratch directory.
describe('seed ecdsa-sd: fixtures issued in memory', () => {
  const issued = new Map<string, {
    records: ReadonlyArray<{ version: number; doc: Json }>;
    keysDir: string;
  }>();

  beforeAll(async () => {
    for (const fixture of ecdsaFixtures) {
      const { id, code } = fixture;
      const dir = tempDir();
      const issuer = await buildEcdsaSdIssuer(
        dir, id, code, fixture.published_at,
        fixture.issuer.did, fixture.platform.did,
      );
      const records = await buildSnapshots(
        fixture, imagesOf(fixture), undefined, issuer,
      );
      issued.set(id, { records, keysDir: join(dir, id, 'dpp', code, 'keys') });
    }
  }, 60_000);

  it('gives every node of every version its own @id', () => {
    for (const [id, { records }] of issued) {
      for (const { version, doc } of records) {
        expect(repeatsOf(nodeIdsOf(unsecured(doc))), `${id} v${version}`)
          .toEqual([]);
      }
    }
  });

  it('asserts each statement once, as the platform issuer requires', () => {
    for (const [id, { records }] of issued) {
      for (const { version, doc } of records) {
        expect(repeatsOf(statementsOf(unsecured(doc))), `${id} v${version}`)
          .toEqual([]);
      }
    }
  });

  it('verifies both proofs of every version', async () => {
    for (const { records, keysDir } of issued.values()) {
      for (const { doc } of records) {
        const v = await verifyDpp(doc, {
          resolveIssuerKey: keyResolver(keysDir),
        });
        expect(dppIsAuthentic(v)).toBe(true);
      }
    }
  });

  // The cradle-to-gate total and the per-stage breakdown: two
  // rows whose propertyIDs slug alike.
  it('keeps the two Volturra carbon footprint rows apart', () => {
    const records = issued.get('volturra-pulse-2000')?.records ?? [];
    expect(records.length).toBeGreaterThan(0);
    for (const { doc } of records) {
      const page = String((doc.credentialSubject as Json)['@id']);
      const carbon = (productOf(doc).properties as Json[])
        .map((p, index) => ({ p, index }))
        .filter(({ p }) => /^carbon[-_]footprint$/.test(String(p.propertyID)));

      const ids = carbon.map(({ p }) => p['@id']);
      const positioned = carbon.map(
        ({ index }) => `${page}#property/carbon-footprint/${index}`,
      );

      expect(carbon).toHaveLength(2);
      expect(ids).toEqual(positioned);
    }
  });
});

// The seed's actual output lives under public/ (gitignored,
// regenerated by `npm run seed`), so this only runs where a
// seed has been produced; CI without one skips it.
const SEEDED = fileURLToPath(new URL(
  '../public/volturra-pulse-2000/dpp/demo-2026-b001', import.meta.url,
));

describe.skipIf(!existsSync(join(SEEDED, 'v/1.json')))(
  'seed ecdsa-sd: produced Volturra artefact', () => {
    it('verifies both proofs of the served snapshot', async () => {
      const vc = JSON.parse(readFileSync(join(SEEDED, 'v/1.json'), 'utf8'));
      const v = await verifyDpp(vc, {
        resolveIssuerKey: keyResolver(join(SEEDED, 'keys')),
      });
      expect(v.cryptosuite).toBe('ecdsa-sd-2023');
      expect(dppIsAuthentic(v)).toBe(true);
    });
  },
);
