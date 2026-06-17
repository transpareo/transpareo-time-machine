/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The standalone verifier widget re-derives the verdict
 * independently of verify.ts/actions.ts. Pass/fail is
 * judged on the DPP's own terms (foreign DPPs verify
 * too); the identity tier (pinned / bound / unconfirmed)
 * decides whether the badge may carry the manifest's
 * platform name. These pin both layers plus the
 * combinedVerdict gates (manifest signature, chain).
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateVerdict, artefactSignatureAcceptable, combinedVerdict,
  verdictIdentity,
} from '../src/verifier-verdict';
import type { ProofEntryResult, VerificationResult } from '../src/crypto/verify';

function entry(over: Partial<ProofEntryResult>): ProofEntryResult {
  return {
    index: 0,
    verificationMethod: 'https://issuer.test/k.json',
    status: 'verified',
    proofValue: 'zsig',
    pinned: false,
    issuerPinned: false,
    ...over,
  };
}

function result(
  entries: ProofEntryResult[],
  over: Partial<VerificationResult> = {},
): VerificationResult {
  const verified = entries.filter((e) => e.status === 'verified');
  return {
    entries,
    verdict: 'authentic',
    verifiedAuthorityCount: new Set(verified.map((e) => e.proofValue)).size,
    totalEntryCount: entries.length,
    verifiedEntryCount: verified.length,
    mode: 'default',
    ...over,
  };
}

const PINS = ['zPinnedPlatformKey', 'zRetiredPlatformKey'];
const MANIFEST_URL = 'https://cdn.platform.example/dpp/manifest.json';

describe('artefactSignatureAcceptable', () => {
  it('tolerates absent/unreachable without a pin set', () => {
    expect(artefactSignatureAcceptable('absent', undefined)).toBe(true);
    expect(artefactSignatureAcceptable(
      entry({ status: 'unreachable' }), undefined,
    )).toBe(true);
  });

  it('treats an empty pin set as unpinned', () => {
    expect(artefactSignatureAcceptable('absent', [])).toBe(true);
    expect(artefactSignatureAcceptable(
      entry({ status: 'unreachable' }), [],
    )).toBe(true);
  });

  it('requires a pin-verified signature on a pinned build', () => {
    expect(artefactSignatureAcceptable('absent', PINS)).toBe(false);
    expect(artefactSignatureAcceptable(
      entry({ status: 'verified', pinned: false }), PINS,
    )).toBe(false);
    expect(artefactSignatureAcceptable(
      entry({ status: 'verified', pinned: true }), PINS,
    )).toBe(true);
  });
});

describe('aggregateVerdict', () => {
  it('delegates to the canonical verdict when authentic', () => {
    const r = result(
      [entry({ proofValue: 'za' }), entry({ proofValue: 'zb' })],
      { verdict: 'authentic' },
    );
    expect(aggregateVerdict(r).outcome).toBe('authentic');
  });

  it('reports the verified/total count when unauthenticated', () => {
    const r = result(
      [entry({ status: 'invalid', proofValue: 'za' })],
      { verdict: 'unauthenticated', verifiedEntryCount: 0, totalEntryCount: 1 },
    );
    const v = aggregateVerdict(r);
    expect(v.outcome).toBe('unauthenticated');
    expect(v.reason).toBe('partial');
    expect(v.verifiedEntryCount).toBe(0);
    expect(v.totalEntryCount).toBe(1);
  });

  it('does not fail a foreign DPP for missing the pin', () => {
    // The pin no longer gates pass/fail; a foreign DPP
    // (no entry matches the pin) still reports authentic
    // on its own terms. Identity is judged separately.
    const r = result([
      entry({ pinned: false, proofValue: 'za' }),
      entry({ pinned: false, proofValue: 'zb' }),
    ]);
    expect(aggregateVerdict(r).outcome).toBe('authentic');
  });
});

describe('verdictIdentity', () => {
  it('is pinned when an entry matched the pin and the manifest did too', () => {
    const r = result([
      entry({ pinned: true, proofValue: 'zPlat' }),
      entry({ pinned: false, proofValue: 'zIssuer' }),
    ]);
    const identity = verdictIdentity(
      r, PINS, entry({ pinned: true }), 'did:web:platform.example',
      MANIFEST_URL,
    );
    expect(identity).toBe('pinned');
  });

  it('downgrades when the manifest signature is not pin-verified', () => {
    // Snapshot entry matched the pin but the manifest is
    // unsigned: the strongest claim is not earned; falls
    // through to the did binding.
    const r = result([
      entry({ pinned: true, proofValue: 'zPlat',
        verificationMethod: 'did:web:platform.example#key-1' }),
      entry({ pinned: false, proofValue: 'zIssuer' }),
    ]);
    const identity = verdictIdentity(
      r, PINS, 'absent', 'did:web:platform.example', MANIFEST_URL,
    );
    expect(identity).toBe('bound');
  });

  it('ignores a pinned-but-invalid entry', () => {
    const r = result([
      entry({ pinned: true, status: 'invalid', proofValue: 'zPlat' }),
      entry({ pinned: false, proofValue: 'zIssuer' }),
    ]);
    const identity = verdictIdentity(
      r, PINS, entry({}), undefined, MANIFEST_URL,
    );
    expect(identity).toBe('unconfirmed');
  });

  it('is bound when a verified did:web key matches platform.did', () => {
    const r = result([
      entry({ verificationMethod: 'did:web:platform.example#key-1' }),
      entry({ proofValue: 'zb', verificationMethod:
        'https://brand.example/keys/issuer.json' }),
    ]);
    const identity = verdictIdentity(
      r, undefined, entry({}), 'did:web:platform.example', MANIFEST_URL,
    );
    expect(identity).toBe('bound');
  });

  it('is bound when an https key URL lives on the did domain', () => {
    const r = result([
      entry({ verificationMethod:
        'https://platform.example/keys/platform.json' }),
    ]);
    const identity = verdictIdentity(
      r, undefined, entry({}), 'did:web:platform.example', MANIFEST_URL,
    );
    expect(identity).toBe('bound');
  });

  it('resolves relative key URLs against the manifest URL', () => {
    const r = result([
      entry({ verificationMethod: '/dpp/keys/platform.json' }),
    ]);
    const identity = verdictIdentity(
      r, undefined, entry({}), 'did:web:cdn.platform.example',
      MANIFEST_URL,
    );
    expect(identity).toBe('bound');
  });

  it('is unconfirmed when keys live elsewhere (name spoofing)', () => {
    // The manifest claims platform.example but the keys
    // resolve from forger.example: the declared name was
    // not earned and the badge must not carry it.
    const r = result([
      entry({ verificationMethod: 'did:web:forger.example#k' }),
      entry({ proofValue: 'zb', verificationMethod:
        'https://forger.example/keys/issuer.json' }),
    ]);
    const identity = verdictIdentity(
      r, undefined, entry({}), 'did:web:platform.example', MANIFEST_URL,
    );
    expect(identity).toBe('unconfirmed');
  });

  it('is unconfirmed without a did:web platform identity', () => {
    const r = result([entry({})]);
    expect(verdictIdentity(r, undefined, entry({}), undefined, MANIFEST_URL))
      .toBe('unconfirmed');
    expect(verdictIdentity(r, undefined, entry({}), 'did:key:z6Mk',
      MANIFEST_URL)).toBe('unconfirmed');
  });
});

describe('combinedVerdict: manifest signature and chain gates', () => {
  const authentic = (): VerificationResult => result([
    entry({ proofValue: 'za' }), entry({ proofValue: 'zb' }),
  ]);

  it('stays authentic when both extra gates pass', () => {
    const v = combinedVerdict(authentic(), entry({}), { status: 'ok' });
    expect(v.outcome).toBe('authentic');
    expect(v.reason).toBe('authentic');
  });

  it('tolerates an unsigned manifest', () => {
    // Pass/fail uses the unpinned tolerance even when the
    // widget carries a pin (a foreign DPP's manifest is
    // never pin-signed); a stripped signature costs the
    // identity tier instead, via verdictIdentity.
    const v = combinedVerdict(
      authentic(), 'absent', { status: 'not-applicable' },
    );
    expect(v.outcome).toBe('authentic');
  });

  it('flips on an invalid manifest signature', () => {
    const v = combinedVerdict(
      authentic(), entry({ status: 'invalid' }), { status: 'ok' },
    );
    expect(v.outcome).toBe('unauthenticated');
    expect(v.reason).toBe('manifestSignature');
  });

  it('flips on a broken version chain', () => {
    const v = combinedVerdict(
      authentic(), entry({}),
      { status: 'broken', reason: 'v2 mismatch' },
    );
    expect(v.outcome).toBe('unauthenticated');
    expect(v.reason).toBe('chainBroken');
  });

  it('keeps the snapshot-proof reason when the base verdict fails', () => {
    const r = result(
      [entry({ status: 'invalid', proofValue: 'za' })],
      { verdict: 'unauthenticated' },
    );
    const v = combinedVerdict(
      r, entry({ status: 'invalid' }), { status: 'broken' },
    );
    expect(v.reason).toBe('partial');
  });
});
