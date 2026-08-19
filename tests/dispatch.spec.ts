/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Cryptosuite dispatch coverage for src/crypto/dispatch.ts.
 * The concern here is routing: a proof reaches the right
 * verifier by its `cryptosuite`, the issuer key resolver
 * is invoked with the verificationMethod, a single proof
 * object and a one-entry proof array are handled alike,
 * and unknown or absent proofs are reported rather than
 * silently passed. The suite-specific crypto is covered by
 * ecdsa-sd.spec.ts and verify.spec.ts.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import {
  verifyDpp, dppIsAuthentic, verifySnapshotAnySuite,
} from '../src/crypto/dispatch';
import {
  keyDocumentError, type ResolvedMultikey
} from '../src/crypto/did-web';
import { createSampleSigner, type SampleSigner } from './helpers/sd-signer';

const ISSUER_MULTIBASE = 'zDnaeSampleIssuerP256Key';

let signer: SampleSigner;

beforeAll(async () => {
  signer = await createSampleSigner();
});

// Resolver that records the method it was asked for and
// returns the sample issuer's key.
function stubResolver(): {
  resolve: (m: string) => Promise<ResolvedMultikey>
  calls: string[]
} {
  const calls: string[] = [];
  return {
    calls,
    resolve: (method: string) => {
      calls.push(method);
      return Promise.resolve({
        multibase: ISSUER_MULTIBASE, bytes: signer.issuer.multikey
      });
    },
  };
}

describe('verifyDpp: routes ecdsa-sd-2023', () => {
  it('resolves the issuer key and verifies a derived proof', async () => {
    const doc = await signer.makeDerived(['recycled']);
    const resolver = stubResolver();
    const v = await verifyDpp(doc, { resolveIssuerKey: resolver.resolve });
    expect(v.cryptosuite).toBe('ecdsa-sd-2023');
    expect(dppIsAuthentic(v)).toBe(true);
    expect(resolver.calls).toEqual(['https://ex.dpp/issuer#key-1']);
  });

  it('carries the resolved Multikey on the proof result', async () => {
    // The renderer compares this against the host page's
    // pinned key sets, so a result that drops it can never
    // satisfy a pin gate.
    const doc = await signer.makeDerived(['recycled']);
    const resolver = stubResolver();
    const v = await verifyDpp(doc, { resolveIssuerKey: resolver.resolve });
    if (v.cryptosuite !== 'ecdsa-sd-2023') {
      throw new Error('expected ecdsa-sd routing');
    }
    expect(v.results[0]?.keyMultibase).toBe(ISSUER_MULTIBASE);
  });

  it('leaves the resolved key off a proof that never resolved', async () => {
    const doc = await signer.makeDerived(['recycled']);
    const v = await verifyDpp(doc, {
      resolveIssuerKey: () => Promise.reject(new Error('offline')),
    });
    if (v.cryptosuite !== 'ecdsa-sd-2023') {
      throw new Error('expected ecdsa-sd routing');
    }
    expect(v.results[0]?.keyMultibase).toBeUndefined();
  });

  it('normalizes a one-entry proof array to a single proof', async () => {
    const doc = await signer.makeDerived(['recycled']);
    doc.proof = [doc.proof];
    const resolver = stubResolver();
    const v = await verifyDpp(doc, { resolveIssuerKey: resolver.resolve });
    expect(v.cryptosuite).toBe('ecdsa-sd-2023');
    expect(dppIsAuthentic(v)).toBe(true);
  });

  it('reports a resolver failure without throwing', async () => {
    const doc = await signer.makeDerived(['recycled']);
    const v = await verifyDpp(doc, {
      resolveIssuerKey: () => Promise.reject(new Error('offline')),
    });
    expect(dppIsAuthentic(v)).toBe(false);
    if (v.cryptosuite === 'ecdsa-sd-2023') {
      expect(v.results[0]?.result.reason).toMatch(/issuer key resolution failed: offline/);
    } else throw new Error('expected ecdsa-sd routing');
  });

  it('reports a proof with no verificationMethod', async () => {
    const doc = await signer.makeDerived(['recycled']);
    delete (doc.proof as Record<string, unknown>).verificationMethod;
    const v = await verifyDpp(doc, {
      resolveIssuerKey: () => Promise.resolve({
        multibase: ISSUER_MULTIBASE, bytes: signer.issuer.multikey,
      }),
    });
    expect(dppIsAuthentic(v)).toBe(false);
    if (v.cryptosuite === 'ecdsa-sd-2023') {
      expect(v.results[0]?.result.reason).toMatch(/no verificationMethod/);
    } else throw new Error('expected ecdsa-sd routing');
  });
});

describe('verifyDpp: routes eddsa-jcs-2022', () => {
  it('sends an eddsa-jcs proof to the whole-document path', async () => {
    // A malformed proofValue keeps the entry from ever
    // fetching a key, so the routing is exercised offline.
    const doc = {
      '@context': ['https://transpareo.com/dpp/v1'],
      proof: [{
        type: 'DataIntegrityProof',
        cryptosuite: 'eddsa-jcs-2022',
        verificationMethod: 'did:web:example.com#key-1',
        proofValue: 'z!!!',
      }],
    };
    const v = await verifyDpp(doc);
    expect(v.cryptosuite).toBe('eddsa-jcs-2022');
    expect(dppIsAuthentic(v)).toBe(false);
    if (v.cryptosuite === 'eddsa-jcs-2022') {
      expect(v.result.verdict).toBe('unauthenticated');
    } else throw new Error('expected eddsa-jcs routing');
  });
});

describe('verifyDpp: unhandled inputs', () => {
  it('reports an unknown cryptosuite', async () => {
    const doc = {
      '@context': [], proof: { type: 'DataIntegrityProof', cryptosuite: 'bbs-2023' },
    };
    const v = await verifyDpp(doc);
    expect(v.cryptosuite).toBe('unknown');
    expect(dppIsAuthentic(v)).toBe(false);
    if (v.cryptosuite === 'unknown') {
      expect(v.reason).toMatch(/unsupported cryptosuite bbs-2023/);
      expect(v.suite).toBe('bbs-2023');
    }
  });

  it('stamps the unsupported suite on the flat result', async () => {
    // Consumers must be able to say "this proof format is
    // not supported" instead of presenting the empty result
    // as a failed verification.
    const doc = {
      '@context': [],
      proof: { type: 'DataIntegrityProof', cryptosuite: 'bbs-2023' },
    };
    const r = await verifySnapshotAnySuite(doc);
    expect(r.verdict).toBe('unauthenticated');
    expect(r.unsupportedSuite).toBe('bbs-2023');
  });

  it('reports a document with no proof', async () => {
    const v = await verifyDpp({ '@context': [] });
    expect(v.cryptosuite).toBe('unknown');
    if (v.cryptosuite === 'unknown') {
      expect(v.reason).toMatch(/no proof/);
    }
  });
});

describe('verifyDpp: a key document served from a cache', () => {
  it('verifies against the origin key when a cache answers stale',
    async () => {
      const doc = await signer.makeDerived(['recycled']);
      const calls: Array<boolean> = [];

      // The plain resolution answers with a key from before a
      // rotation, as a CDN holding an old copy does; the
      // bypass reaches the origin and answers with the key
      // that signed.
      const resolve = (m: string, options?: { bypassCache?: boolean }) => {
        calls.push(options?.bypassCache === true);
        return Promise.resolve(options?.bypassCache
          ? { multibase: ISSUER_MULTIBASE, bytes: signer.issuer.multikey }
          : { multibase: 'zDnaeStaleKey', bytes: new Uint8Array(35) });
      };

      const v = await verifyDpp(doc, { resolveIssuerKey: resolve });

      expect(dppIsAuthentic(v)).toBe(true);
      expect(calls).toEqual([false, true]);
      if (v.cryptosuite !== 'ecdsa-sd-2023') {
        throw new Error('expected ecdsa-sd routing');
      }
      expect(v.results[0]?.keyMultibase).toBe(ISSUER_MULTIBASE);
    });

  it('retries once and stops when the origin key is the same',
    async () => {
      const doc = await signer.makeDerived(['recycled']);
      const calls: Array<boolean> = [];

      // Cache and origin agree on a key that did not sign, so
      // there is nothing to heal and no third attempt.
      const resolve = (m: string, options?: { bypassCache?: boolean }) => {
        calls.push(options?.bypassCache === true);
        return Promise.resolve({
          multibase: 'zDnaeWrongKey', bytes: new Uint8Array(35),
        });
      };

      const v = await verifyDpp(doc, { resolveIssuerKey: resolve });

      expect(dppIsAuthentic(v)).toBe(false);
      expect(calls).toEqual([false, true]);
    });
});

describe('verifyDpp: a key document with no key for the method', () => {
  it('re-resolves past the caches and verifies', async () => {
    const doc = await signer.makeDerived(['recycled']);
    const calls: Array<boolean> = [];

    // The cached copy predates the key being added, so the
    // plain resolution reaches a document and finds nothing.
    const resolve = (m: string, options?: { bypassCache?: boolean }) => {
      calls.push(options?.bypassCache === true);
      if (!options?.bypassCache) {
        return Promise.reject(
          keyDocumentError('DID document has no matching verificationMethod')
        );
      }
      return Promise.resolve({
        multibase: ISSUER_MULTIBASE, bytes: signer.issuer.multikey,
      });
    };

    const v = await verifyDpp(doc, { resolveIssuerKey: resolve });

    expect(dppIsAuthentic(v)).toBe(true);
    expect(calls).toEqual([false, true]);
  });

  it('does not retry a host that never answered', async () => {
    const doc = await signer.makeDerived(['recycled']);
    const calls: Array<boolean> = [];

    const resolve = (m: string, options?: { bypassCache?: boolean }) => {
      calls.push(options?.bypassCache === true);
      return Promise.reject(new TypeError('Failed to fetch'));
    };

    const v = await verifyDpp(doc, { resolveIssuerKey: resolve });

    expect(dppIsAuthentic(v)).toBe(false);
    expect(calls).toEqual([false]);
  });
});
