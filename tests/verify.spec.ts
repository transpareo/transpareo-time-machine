/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * End-to-end coverage for src/crypto/verify.ts using
 * real Ed25519 keys (WebCrypto, available in Node 22+)
 * and a stubbed fetch that returns Multikey resolution
 * docs. The aggregate-verdict rule (default = any-issuer
 * AND any-platform, strict = all entries) is the
 * meaning of the "Verified by Transpareo" chip; these
 * tests pin it down.
 *
 * The verifier holds a module-level keyCache, so each
 * test resets modules and re-imports `verifySnapshot`
 * to get a fresh cache. Otherwise a 404 in test N would
 * poison the lookup in test N+1 (or vice versa: a stale
 * key would mask a real fetch problem).
 */

import {
  describe, it, expect, afterEach, vi,
} from 'vitest';
import { canonicalize } from '../src/crypto/jcs';
import { encodeMultibaseBase58 } from '../src/crypto/multibase';
import type {
  ProofEntryResult,
  VerificationResult,
} from '../src/crypto/verify';

const ED25519_PREFIX = new Uint8Array([0xed, 0x01]);

interface Authority {
  privateKey: CryptoKey;
  publicKeyMultibase: string;
}

async function makeAuthority(): Promise<Authority> {
  const kp = (await crypto.subtle.generateKey(
    { name: 'Ed25519' } as AlgorithmIdentifier,
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(
    await crypto.subtle.exportKey('raw', kp.publicKey),
  );
  const multikey = new Uint8Array(2 + raw.length);
  multikey.set(ED25519_PREFIX, 0);
  multikey.set(raw, 2);
  return {
    privateKey: kp.privateKey,
    publicKeyMultibase: encodeMultibaseBase58(multikey),
  };
}

async function hashBody(body: unknown): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(canonicalize(body));
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

// Same ArrayBufferLike-vs-ArrayBuffer workaround the
// verifier uses (see src/crypto/verify.ts:asBuffer): the
// runtime values are plain ArrayBuffer-backed, but
// recent TS lib types narrow Uint8Array to a generic
// ArrayBufferLike that the BufferSource union rejects.
function asBuffer(u: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u.byteLength);
  new Uint8Array(out).set(u);
  return out;
}

async function signHash(
  privateKey: CryptoKey, hash: Uint8Array,
): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign(
    { name: 'Ed25519' }, privateKey, asBuffer(hash),
  );
  return new Uint8Array(sig);
}

// Three issuer aliases, two platform aliases -- mirrors
// the seed-side shape so the verifier's authority-
// grouping logic runs against a realistic proof set.
const ISSUER_URLS = [
  'https://issuer.test/keys/issuer.json',
  'https://issuer.test/keys/issuer.json#did-web',
  'https://cdn.test/keys/issuer.json#cdn',
] as const;

const PLATFORM_URLS = [
  'https://platform.test/keys/platform.json',
  'https://platform.test/keys/platform.json#did-web',
] as const;

interface ProofEntry {
  type: 'DataIntegrityProof';
  cryptosuite: 'eddsa-jcs-sha256';
  created: string;
  proofPurpose: 'assertionMethod';
  verificationMethod: string;
  proofValue: string;
}

interface SignedSnapshot {
  version: number;
  publishedAt: string;
  proof: ProofEntry[];
}

interface Setup {
  snapshot: SignedSnapshot;
  issuer: Authority;
  platform: Authority;
  issuerProofValue: string;
  platformProofValue: string;
}

async function buildSignedSnapshot(): Promise<Setup> {
  const issuer = await makeAuthority();
  const platform = await makeAuthority();
  const body = {
    version: 1,
    publishedAt: '2026-01-01T00:00:00Z',
  };
  const hash = await hashBody(body);
  const issuerSig = await signHash(issuer.privateKey, hash);
  const platformSig = await signHash(platform.privateKey, hash);
  const issuerProofValue = encodeMultibaseBase58(issuerSig);
  const platformProofValue = encodeMultibaseBase58(platformSig);

  const buildEntry = (
    url: string, proofValue: string,
  ): ProofEntry => ({
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-sha256',
    created: '2026-01-01T00:00:00Z',
    proofPurpose: 'assertionMethod',
    verificationMethod: url,
    proofValue,
  });

  return {
    snapshot: {
      ...body,
      proof: [
        ...ISSUER_URLS.map((u) => buildEntry(u, issuerProofValue)),
        ...PLATFORM_URLS.map((u) => buildEntry(u, platformProofValue)),
      ],
    },
    issuer,
    platform,
    issuerProofValue,
    platformProofValue,
  };
}

// Stubbed fetch resolving every issuer/platform URL to
// the right key. Tests can prune entries to simulate
// unreachable hosts, swap multikeys to simulate
// resolution-doc tampering, etc.
function stubResolverFetch(map: Map<string, string>): void {
  vi.stubGlobal('fetch', async (input: string | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const multikey = map.get(url);
    if (!multikey) {
      return new Response('not found', { status: 404 });
    }
    return new Response(
      JSON.stringify({
        id: url,
        type: 'Multikey',
        publicKeyMultibase: multikey,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
}

function fullResolverMap(setup: Setup): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of ISSUER_URLS) {
    map.set(u, setup.issuer.publicKeyMultibase);
  }
  for (const u of PLATFORM_URLS) {
    map.set(u, setup.platform.publicKeyMultibase);
  }
  return map;
}

// Pull a fresh verifier so the module-level keyCache is
// empty between tests.
async function freshVerifier(): Promise<
  typeof import('../src/crypto/verify').verifySnapshot
> {
  vi.resetModules();
  const mod = await import('../src/crypto/verify');
  return mod.verifySnapshot;
}

async function run(
  setup: Setup,
  map: Map<string, string>,
  opts?: {
    mode?: 'default' | 'strict';
    pinnedPlatformKeys?: ReadonlyArray<string>;
    pinnedIssuerKeys?: ReadonlyArray<string>;
  },
): Promise<VerificationResult> {
  stubResolverFetch(map);
  const verifySnapshot = await freshVerifier();
  return verifySnapshot(setup.snapshot, opts);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verifySnapshot: happy path', () => {
  it('reports authentic with both authorities and all 5 entries', async () => {
    const setup = await buildSignedSnapshot();
    const result = await run(setup, fullResolverMap(setup));
    expect(result.verdict).toBe('authentic');
    expect(result.verifiedAuthorityCount).toBe(2);
    expect(result.verifiedEntryCount).toBe(5);
    expect(result.totalEntryCount).toBe(5);
    expect(result.mode).toBe('default');
    expect(result.entries.every((e) => e.status === 'verified'))
      .toBe(true);
  });
});

describe('verifySnapshot: did:web resolution', () => {
  it('resolves a did:web method via its did.json by fragment', async () => {
    const setup = await buildSignedSnapshot();
    const didMethod = 'did:web:issuer.test#key-1';
    const entry = (
      url: string, proofValue: string,
    ): ProofEntry => ({
      type: 'DataIntegrityProof',
      cryptosuite: 'eddsa-jcs-sha256',
      created: '2026-01-01T00:00:00Z',
      proofPurpose: 'assertionMethod',
      verificationMethod: url,
      proofValue,
    });
    const snapshot: SignedSnapshot = {
      version: setup.snapshot.version,
      publishedAt: setup.snapshot.publishedAt,
      proof: [
        entry(didMethod, setup.issuerProofValue),
        ...PLATFORM_URLS.map((u) => entry(u, setup.platformProofValue)),
      ],
    };

    vi.stubGlobal('fetch', async (input: string | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://issuer.test/.well-known/did.json') {
        // Two keys in the document; the proof's #key-1
        // fragment must select the matching one.
        return new Response(JSON.stringify({
          id: 'did:web:issuer.test',
          verificationMethod: [
            {
              id: 'did:web:issuer.test#key-0',
              type: 'Multikey',
              publicKeyMultibase: setup.platform.publicKeyMultibase,
            },
            {
              id: 'did:web:issuer.test#key-1',
              type: 'Multikey',
              publicKeyMultibase: setup.issuer.publicKeyMultibase,
            },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if ((PLATFORM_URLS as readonly string[]).includes(url)) {
        return new Response(JSON.stringify({
          id: url, type: 'Multikey',
          publicKeyMultibase: setup.platform.publicKeyMultibase,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    });

    const verifySnapshot = await freshVerifier();
    const result = await verifySnapshot(snapshot);

    const didEntry = result.entries.find(
      (e) => e.verificationMethod === didMethod,
    );
    expect(didEntry?.status).toBe('verified');
    expect(result.verdict).toBe('authentic');
    expect(result.verifiedAuthorityCount).toBe(2);
  });
});

describe('verifySnapshot: verificationMethod scheme restriction', () => {
  const entry = (url: string, proofValue: string): ProofEntry => ({
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-sha256',
    created: '2026-01-01T00:00:00Z',
    proofPurpose: 'assertionMethod',
    verificationMethod: url,
    proofValue,
  });

  // The resolver map deliberately KNOWS the forbidden URL
  // and would hand back the correct key, so a 'verified'
  // entry would prove the URL was fetched. 'unreachable'
  // proves the scheme was refused before any fetch.
  async function entryForMethod(
    badUrl: string,
  ): Promise<ProofEntryResult | undefined> {
    const setup = await buildSignedSnapshot();
    const snapshot: SignedSnapshot = {
      version: setup.snapshot.version,
      publishedAt: setup.snapshot.publishedAt,
      proof: [
        entry(badUrl, setup.issuerProofValue),
        ...PLATFORM_URLS.map((u) => entry(u, setup.platformProofValue)),
      ],
    };
    const map = fullResolverMap(setup);
    map.set(badUrl, setup.issuer.publicKeyMultibase);
    stubResolverFetch(map);
    const verifySnapshot = await freshVerifier();
    const result = await verifySnapshot(snapshot);
    return result.entries.find((e) => e.verificationMethod === badUrl);
  }

  it('refuses an http: method without fetching it', async () => {
    const e = await entryForMethod('http://issuer.test/keys/issuer.json');
    expect(e?.status).toBe('unreachable');
    expect(e?.reason).toMatch(/refusing to resolve a http:/);
  });

  it('refuses a data: method', async () => {
    const e = await entryForMethod(
      'data:application/json,{"publicKeyMultibase":"zfake"}',
    );
    expect(e?.status).toBe('unreachable');
    expect(e?.reason).toMatch(/refusing to resolve a data:/);
  });

  it('refuses a non-web did method', async () => {
    const e = await entryForMethod('did:key:z6MkFakeKey');
    expect(e?.status).toBe('unreachable');
    expect(e?.reason).toMatch(/refusing to resolve a did:/);
  });
});

describe('verifySnapshot: partial reachability', () => {
  it('tolerates one issuer alias 404 (still authentic)', async () => {
    const setup = await buildSignedSnapshot();
    const map = fullResolverMap(setup);
    map.delete(ISSUER_URLS[1]);
    const result = await run(setup, map);
    expect(result.verdict).toBe('authentic');
    expect(result.verifiedAuthorityCount).toBe(2);
    expect(result.verifiedEntryCount).toBe(4);
    const downEntry = result.entries.find(
      (e) => e.verificationMethod === ISSUER_URLS[1],
    );
    expect(downEntry?.status).toBe('unreachable');
  });

  it('flips unauthenticated when every issuer alias is 404', async () => {
    const setup = await buildSignedSnapshot();
    const map = fullResolverMap(setup);
    for (const u of ISSUER_URLS) map.delete(u);
    const result = await run(setup, map);
    expect(result.verdict).toBe('unauthenticated');
    expect(result.verifiedAuthorityCount).toBe(1);
    expect(result.verifiedEntryCount).toBe(2);
  });

  it('flips unauthenticated when every platform alias is 404', async () => {
    const setup = await buildSignedSnapshot();
    const map = fullResolverMap(setup);
    for (const u of PLATFORM_URLS) map.delete(u);
    const result = await run(setup, map);
    expect(result.verdict).toBe('unauthenticated');
    expect(result.verifiedAuthorityCount).toBe(1);
    expect(result.verifiedEntryCount).toBe(3);
  });
});

describe('verifySnapshot: tampering', () => {
  it('marks an entry invalid when its signature is mutated', async () => {
    const setup = await buildSignedSnapshot();

    // Mutate one issuer entry's proofValue by swapping
    // the last base58 char. Other entries still share
    // the original signature so the authority count is
    // unchanged.
    const targetIndex = 0;
    const original = setup.snapshot.proof[targetIndex].proofValue;
    const swapped = original.slice(0, -1)
      + (original.endsWith('2') ? '3' : '2');
    setup.snapshot.proof[targetIndex] = {
      ...setup.snapshot.proof[targetIndex],
      proofValue: swapped,
    };

    const result = await run(setup, fullResolverMap(setup));
    expect(result.entries[targetIndex].status).toBe('invalid');

    // The other four entries still verify; both
    // authorities still represented.
    expect(result.verdict).toBe('authentic');
    expect(result.verifiedAuthorityCount).toBe(2);
    expect(result.verifiedEntryCount).toBe(4);
  });

  it('marks all entries invalid when the body is tampered', async () => {
    const setup = await buildSignedSnapshot();

    // Re-sign nothing; just flip the body. Every entry's
    // signature now verifies against a stale hash.
    (setup.snapshot as { publishedAt: string }).publishedAt =
      '2026-12-31T23:59:59Z';
    const result = await run(setup, fullResolverMap(setup));
    expect(result.verdict).toBe('unauthenticated');
    expect(result.verifiedEntryCount).toBe(0);
    expect(result.entries.every((e) => e.status === 'invalid'))
      .toBe(true);
  });

  it('rejects entries whose resolved key is wrong', async () => {
    const setup = await buildSignedSnapshot();

    // Resolver returns the *platform* key for an issuer
    // URL: the signature stops verifying.
    const map = fullResolverMap(setup);
    map.set(ISSUER_URLS[0], setup.platform.publicKeyMultibase);
    const result = await run(setup, map);
    const swapped = result.entries.find(
      (e) => e.verificationMethod === ISSUER_URLS[0],
    );
    expect(swapped?.status).toBe('invalid');
    expect(swapped?.reason).toMatch(/does not verify/);

    // Verdict still authentic: the other 4 entries cover
    // both authorities.
    expect(result.verdict).toBe('authentic');
  });
});

describe('verifySnapshot: edge cases', () => {
  it('returns unauthenticated for an empty proof set', async () => {
    stubResolverFetch(new Map());
    const verifySnapshot = await freshVerifier();
    const result = await verifySnapshot({ proof: [] });
    expect(result.verdict).toBe('unauthenticated');
    expect(result.totalEntryCount).toBe(0);
    expect(result.entries).toEqual([]);
  });

  it('returns unauthenticated for a missing proof field', async () => {
    stubResolverFetch(new Map());
    const verifySnapshot = await freshVerifier();
    const result = await verifySnapshot({});
    expect(result.verdict).toBe('unauthenticated');
    expect(result.totalEntryCount).toBe(0);
  });

  it('rejects a malformed proofValue with status invalid', async () => {
    const setup = await buildSignedSnapshot();
    setup.snapshot.proof[0] = {
      ...setup.snapshot.proof[0],
      proofValue: 'not-a-z-prefixed-string',
    };
    const result = await run(setup, fullResolverMap(setup));
    expect(result.entries[0].status).toBe('invalid');
    expect(result.entries[0].reason).toMatch(/encoding/);
  });

  it('rejects a resolution doc missing publicKeyMultibase', async () => {
    const setup = await buildSignedSnapshot();
    vi.stubGlobal('fetch', async (): Promise<Response> => new Response(
      JSON.stringify({ id: 'x', type: 'Multikey' }),
      { status: 200 },
    ));
    const verifySnapshot = await freshVerifier();
    const result = await verifySnapshot(setup.snapshot);
    expect(result.verdict).toBe('unauthenticated');
    expect(result.entries.every((e) => e.status === 'unreachable'))
      .toBe(true);
  });
});

describe('verifySnapshot: pure-JS Ed25519 fallback', () => {
  it('verifies via noble when native WebCrypto Ed25519 is absent', async () => {
    const setup = await buildSignedSnapshot();

    // Simulate a browser without native Ed25519: importKey
    // throws for Ed25519, forcing the lazily-loaded pure-JS
    // verifier. digest() and the test's own sign/generate
    // keep working (they don't go through importKey).
    const realImport = crypto.subtle.importKey.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'importKey').mockImplementation(
      (async (...args: Parameters<typeof crypto.subtle.importKey>) => {
        const algo = args[2] as { name?: string } | string;
        const name = typeof algo === 'string' ? algo : algo?.name;
        if (name === 'Ed25519') throw new Error('NotSupportedError');
        return realImport(...args);
      }) as typeof crypto.subtle.importKey,
    );

    const result = await run(setup, fullResolverMap(setup));
    expect(result.verdict).toBe('authentic');
    expect(result.verifiedEntryCount).toBe(5);
    expect(result.entries.every((e) => e.status === 'verified')).toBe(true);
  });

  it('rejects a tampered signature via the fallback too', async () => {
    const setup = await buildSignedSnapshot();
    const original = setup.snapshot.proof[0].proofValue;
    setup.snapshot.proof[0] = {
      ...setup.snapshot.proof[0],
      proofValue: original.slice(0, -1) + (original.endsWith('2') ? '3' : '2'),
    };
    const realImport = crypto.subtle.importKey.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'importKey').mockImplementation(
      (async (...args: Parameters<typeof crypto.subtle.importKey>) => {
        const algo = args[2] as { name?: string } | string;
        const name = typeof algo === 'string' ? algo : algo?.name;
        if (name === 'Ed25519') throw new Error('NotSupportedError');
        return realImport(...args);
      }) as typeof crypto.subtle.importKey,
    );

    const result = await run(setup, fullResolverMap(setup));
    expect(result.entries[0].status).toBe('invalid');
  });
});

describe('verifySnapshot: malformed proof bytes', () => {
  it('rejects a signature that decodes to fewer than 64 bytes', async () => {
    const setup = await buildSignedSnapshot();

    // Valid z-multibase, but only 10 bytes of payload.
    setup.snapshot.proof[0] = {
      ...setup.snapshot.proof[0],
      proofValue: encodeMultibaseBase58(new Uint8Array(10)),
    };
    const result = await run(setup, fullResolverMap(setup));
    expect(result.entries[0].status).toBe('invalid');
    expect(result.entries[0].reason).toMatch(/expected 64/);
  });

  it('rejects a resolution doc whose key is not an Ed25519 multikey', async () => {
    const setup = await buildSignedSnapshot();

    // 34 bytes decode cleanly but the multicodec prefix is
    // 0x00 0x00, not the Ed25519 0xed 0x01.
    const wrongMultibase = encodeMultibaseBase58(new Uint8Array(34));
    const map = fullResolverMap(setup);
    for (const u of ISSUER_URLS) map.set(u, wrongMultibase);
    const result = await run(setup, map);
    const issuerEntries = result.entries.filter(
      (e) => (ISSUER_URLS as readonly string[]).includes(e.verificationMethod),
    );
    expect(issuerEntries.every((e) => e.status === 'unreachable')).toBe(true);
    expect(issuerEntries[0].reason).toMatch(/Ed25519 multikey/);
  });
});

describe('verifySnapshot: strict mode', () => {
  it('passes strict when all entries verify', async () => {
    const setup = await buildSignedSnapshot();
    const result = await run(setup, fullResolverMap(setup), {
      mode: 'strict',
    });
    expect(result.verdict).toBe('authentic');
    expect(result.mode).toBe('strict');
    expect(result.verifiedEntryCount).toBe(5);
  });

  it('fails strict when even one entry is unreachable', async () => {
    const setup = await buildSignedSnapshot();
    const map = fullResolverMap(setup);
    map.delete(ISSUER_URLS[2]);
    const result = await run(setup, map, { mode: 'strict' });
    expect(result.verdict).toBe('unauthenticated');
    expect(result.verifiedEntryCount).toBe(4);

    // Default mode would have called this authentic.
    expect(result.mode).toBe('strict');
  });
});

describe('verifySnapshot: pinned platform key', () => {
  it('flags entries whose key matches the pin', async () => {
    const setup = await buildSignedSnapshot();
    const result = await run(setup, fullResolverMap(setup), {
      pinnedPlatformKeys: [setup.platform.publicKeyMultibase],
    });

    // The two platform entries should be pinned; the
    // three issuer entries should not be.
    const pinned = result.entries.filter((e) => e.pinned);
    expect(pinned.length).toBe(2);
    expect(pinned.every(
      (e) => PLATFORM_URLS.includes(
        e.verificationMethod as typeof PLATFORM_URLS[number],
      ),
    )).toBe(true);
  });

  it('does not flag pinned when the entry failed to verify', async () => {
    // The defense in verify.ts:268-273: pinning is only
    // meaningful when the signature actually verified --
    // otherwise an attacker who controls the URL the
    // verifier fetches could trivially flag any entry as
    // pinned by returning the pinned multikey.
    const setup = await buildSignedSnapshot();

    // Tamper one platform entry's signature so it
    // verifies as invalid, but the resolver still
    // returns the genuine platform multikey (which
    // matches the pin).
    const target = setup.snapshot.proof.length - 1;
    const original = setup.snapshot.proof[target].proofValue;
    setup.snapshot.proof[target] = {
      ...setup.snapshot.proof[target],
      proofValue: original.slice(0, -1)
        + (original.endsWith('2') ? '3' : '2'),
    };
    const result = await run(setup, fullResolverMap(setup), {
      pinnedPlatformKeys: [setup.platform.publicKeyMultibase],
    });
    const tamperedEntry = result.entries[target];
    expect(tamperedEntry.status).toBe('invalid');
    expect(tamperedEntry.pinned).toBe(false);
  });

  it('reports pinned=false on every entry when no pin is supplied', async () => {
    const setup = await buildSignedSnapshot();
    const result = await run(setup, fullResolverMap(setup));
    expect(result.entries.every((e) => e.pinned === false)).toBe(true);
  });

  it('accepts a match against any key in the pin set', async () => {
    // Key rotation keeps retired-but-sound platform keys in
    // the pin set; a snapshot signed under an older version
    // must still flag its platform entries as pinned.
    const setup = await buildSignedSnapshot();
    const result = await run(setup, fullResolverMap(setup), {
      pinnedPlatformKeys: [
        'z6MkSomeNewerRotatedPlatformKey',
        setup.platform.publicKeyMultibase,
      ],
    });
    const pinned = result.entries.filter((e) => e.pinned);
    expect(pinned.length).toBe(2);
  });

  it('flags nothing when no pin in the set matches', async () => {
    const setup = await buildSignedSnapshot();
    const result = await run(setup, fullResolverMap(setup), {
      pinnedPlatformKeys: ['z6MkSomeForeignPlatformKey'],
    });
    expect(result.entries.every((e) => e.pinned === false)).toBe(true);
  });
});

describe('verifySnapshot: pinned issuer key', () => {
  it('flags issuer entries whose key matches an issuer pin', async () => {
    const setup = await buildSignedSnapshot();
    const result = await run(setup, fullResolverMap(setup), {
      pinnedPlatformKeys: [setup.platform.publicKeyMultibase],
      pinnedIssuerKeys: [setup.issuer.publicKeyMultibase],
    });
    const issuerPinned = result.entries.filter((e) => e.issuerPinned);
    expect(issuerPinned.length).toBe(3);
    expect(issuerPinned.every(
      (e) => ISSUER_URLS.includes(
        e.verificationMethod as typeof ISSUER_URLS[number],
      ),
    )).toBe(true);

    // The platform pin and the issuer pin tag disjoint
    // entry sets.
    expect(issuerPinned.some((e) => e.pinned)).toBe(false);
  });

  it('reports issuerPinned=false everywhere without issuer pins', async () => {
    const setup = await buildSignedSnapshot();
    const result = await run(setup, fullResolverMap(setup), {
      pinnedPlatformKeys: [setup.platform.publicKeyMultibase],
    });
    expect(result.entries.every((e) => e.issuerPinned === false))
      .toBe(true);
  });

  it('does not flag issuerPinned when the entry failed to verify', async () => {
    const setup = await buildSignedSnapshot();
    const original = setup.snapshot.proof[0].proofValue;
    setup.snapshot.proof[0] = {
      ...setup.snapshot.proof[0],
      proofValue: original.slice(0, -1)
        + (original.endsWith('2') ? '3' : '2'),
    };
    const result = await run(setup, fullResolverMap(setup), {
      pinnedIssuerKeys: [setup.issuer.publicKeyMultibase],
    });
    expect(result.entries[0].status).toBe('invalid');
    expect(result.entries[0].issuerPinned).toBe(false);
  });
});

describe('verifySnapshot: authority grouping by signature', () => {
  // The renderer groups verified entries by proofValue,
  // not by URL pattern, so authority count is robust to
  // host renames. With all 5 entries verifying, the
  // group set is exactly the two distinct signature
  // values.
  it('groups by proofValue, not by verificationMethod URL', async () => {
    const setup = await buildSignedSnapshot();
    const result = await run(setup, fullResolverMap(setup));
    const verifiedSigs = new Set(
      result.entries
        .filter((e) => e.status === 'verified')
        .map((e) => e.proofValue),
    );
    expect(verifiedSigs.size).toBe(2);
    expect(verifiedSigs.has(setup.issuerProofValue)).toBe(true);
    expect(verifiedSigs.has(setup.platformProofValue)).toBe(true);
  });
});

describe('verifyManifestSignature', () => {
  const PLATFORM_KEY_URL = 'https://platform.test/keys/platform.json';

  const buildSignature = (proofValue: string) => ({
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-sha256',
    created: '2026-01-01T00:00:00Z',
    verificationMethod: PLATFORM_KEY_URL,
    proofPurpose: 'assertionMethod',
    proofValue,
  });

  async function freshManifestVerifier(): Promise<
    typeof import('../src/crypto/verify').verifyManifestSignature
  > {
    vi.resetModules();
    return (await import('../src/crypto/verify')).verifyManifestSignature;
  }

  it('verifies a correctly signed manifest version list', async () => {
    const platform = await makeAuthority();
    const body = {
      '@type': 'DppManifest',
      code: 'abc-123',
      currentVersion: 2,
      versions: [
        { number: 1, url: 'v/1.json', hashValue: 'aa' },
        { number: 2, url: 'v/2.json', hashValue: 'bb' },
      ],
    };
    const sig = await signHash(platform.privateKey, await hashBody(body));
    const manifest = {
      ...body,
      signature: buildSignature(encodeMultibaseBase58(sig)),
    };
    stubResolverFetch(new Map([[PLATFORM_KEY_URL, platform.publicKeyMultibase]]));
    const verifyManifestSignature = await freshManifestVerifier();
    const res = await verifyManifestSignature(manifest);
    expect(res?.status).toBe('verified');
  });

  it('rejects a manifest whose version list was tampered after signing', async () => {
    const platform = await makeAuthority();
    const body = {
      '@type': 'DppManifest', code: 'abc-123', currentVersion: 2,
    };
    const sig = await signHash(platform.privateKey, await hashBody(body));
    const manifest = {
      ...body,

      // Flip currentVersion AFTER signing: the version list no
      // longer matches the signed bytes.
      currentVersion: 3,
      signature: buildSignature(encodeMultibaseBase58(sig)),
    };
    stubResolverFetch(new Map([[PLATFORM_KEY_URL, platform.publicKeyMultibase]]));
    const verifyManifestSignature = await freshManifestVerifier();
    const res = await verifyManifestSignature(manifest);
    expect(res?.status).toBe('invalid');
    expect(res?.reason).toMatch(/does not verify/);
  });

  it('rejects a manifest signed by the wrong key', async () => {
    const platform = await makeAuthority();
    const impostor = await makeAuthority();
    const body = { '@type': 'DppManifest', code: 'abc-123', currentVersion: 1 };
    const sig = await signHash(platform.privateKey, await hashBody(body));
    const manifest = {
      ...body,
      signature: buildSignature(encodeMultibaseBase58(sig)),
    };

    // Resolver returns the impostor's key, not the signer's.
    stubResolverFetch(new Map([[PLATFORM_KEY_URL, impostor.publicKeyMultibase]]));
    const verifyManifestSignature = await freshManifestVerifier();
    const res = await verifyManifestSignature(manifest);
    expect(res?.status).toBe('invalid');
  });

  it('returns null when the manifest carries no signature', async () => {
    const verifyManifestSignature = await freshManifestVerifier();
    const res = await verifyManifestSignature({ '@type': 'DppManifest' });
    expect(res).toBeNull();
  });

  // The events sidecar (EPCIS document) carries the same
  // single-signature scheme as the manifest, so the SPA
  // verifies it with this same function. These cases pin down
  // that the whole eventList is covered by the document
  // signature.
  const epcisBody = () => ({
    '@context': [
      'https://ref.gs1.org/standards/epcis/2.0.0/epcis-context.jsonld',
      'https://transpareo.com/vocab/transpareo/v1',
    ],
    type: 'EPCISDocument',
    schemaVersion: '2.0',
    creationDate: '2026-01-01T00:00:00Z',
    epcisBody: {
      eventList: [
        {
          type: 'ObjectEvent',
          eventID: 'urn:uuid:event-1',
          action: 'OBSERVE',
          bizStep: 'cbv:BizStep-repairing',
          'transpareo:dppEventId': 'evt-1',
        },
      ],
    },
  });

  it('verifies a correctly signed EPCIS events document', async () => {
    const platform = await makeAuthority();
    const body = epcisBody();
    const sig = await signHash(platform.privateKey, await hashBody(body));
    const doc = {
      ...body,
      signature: buildSignature(encodeMultibaseBase58(sig)),
    };
    stubResolverFetch(new Map([[PLATFORM_KEY_URL, platform.publicKeyMultibase]]));
    const verifyManifestSignature = await freshManifestVerifier();
    const res = await verifyManifestSignature(doc);
    expect(res?.status).toBe('verified');
  });

  it('rejects an EPCIS document whose eventList was tampered', async () => {
    const platform = await makeAuthority();
    const body = epcisBody();
    const sig = await signHash(platform.privateKey, await hashBody(body));

    // Rewrite the event's bizStep AFTER signing: the timeline
    // the consumer would see no longer matches the signed
    // bytes.
    const doc = {
      ...body,
      epcisBody: {
        eventList: [
          { ...body.epcisBody.eventList[0], bizStep: 'cbv:BizStep-shipping' },
        ],
      },
      signature: buildSignature(encodeMultibaseBase58(sig)),
    };
    stubResolverFetch(new Map([[PLATFORM_KEY_URL, platform.publicKeyMultibase]]));
    const verifyManifestSignature = await freshManifestVerifier();
    const res = await verifyManifestSignature(doc);
    expect(res?.status).toBe('invalid');
    expect(res?.reason).toMatch(/does not verify/);
  });

  it('returns null when the events document carries no signature', async () => {
    const verifyManifestSignature = await freshManifestVerifier();
    const res = await verifyManifestSignature(epcisBody());
    expect(res).toBeNull();
  });
});
