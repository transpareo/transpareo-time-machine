/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Covers the two verdict gates that must fail closed:
 *
 *   - signatureIsAcceptable: the shared gate for a
 *     platform signature over a whole artefact (manifest
 *     version list or events sidecar). Unpinned builds
 *     tolerate a missing signature or an unreachable key
 *     host but fail closed on a present-but-invalid
 *     signature; a build that pins a platform key fails
 *     closed on everything except a signature verified
 *     under that pinned key. A missing artefact (null:
 *     single-snapshot boot, no events sidecar) is out of
 *     scope either way.
 *   - armRevocationGuard: a 'revoked' result that lands
 *     after a version already verified still forces that
 *     version's stored verdict to 'failed', closing the
 *     boot-race fail-open.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  signatureIsAcceptable, armRevocationGuard, pinGatesOk,
} from '@/actions';
import { versionStates } from '@/state';
import { revocationStatus } from '@/revoked-roots';
import { config } from '@/config';
import type { ProofEntryResult, VerificationResult } from '@/crypto/verify';

const RESULT: VerificationResult = {
  entries: [],
  verdict: 'authentic',
  verifiedAuthorityCount: 2,
  totalEntryCount: 2,
  verifiedEntryCount: 2,
  mode: 'default',
};

type MutablePins = {
  pinnedPlatformKeys?: ReadonlyArray<string>
  pinnedIssuerKeys?: ReadonlyArray<string>
};

function entry(
  status: ProofEntryResult['status'],
  pinned = false,
  issuerPinned = false,
): ProofEntryResult {
  return {
    index: 0, verificationMethod: '', proofValue: '',
    pinned, issuerPinned, status,
  };
}

describe('signatureIsAcceptable (no platform key pinned)', () => {
  it('tolerates a missing artefact', () => {
    expect(signatureIsAcceptable(null)).toBe(true);
  });

  it('tolerates an artefact that is present but unsigned', () => {
    expect(signatureIsAcceptable('absent')).toBe(true);
  });

  it('tolerates an unreachable key host', () => {
    expect(signatureIsAcceptable(entry('unreachable'))).toBe(true);
  });

  it('fails closed on a present-but-invalid signature', () => {
    expect(signatureIsAcceptable(entry('invalid'))).toBe(false);
  });

  it('accepts a verified signature when no key is pinned', () => {
    expect(signatureIsAcceptable(entry('verified'))).toBe(true);
  });
});

describe('signatureIsAcceptable (platform key pinned)', () => {
  const mutableConfig = config as MutablePins;

  beforeEach(() => {
    mutableConfig.pinnedPlatformKeys = ['z6MkTestPinnedPlatformKey'];
  });

  afterEach(() => {
    delete mutableConfig.pinnedPlatformKeys;
  });

  it('fails closed on an unsigned artefact', () => {
    expect(signatureIsAcceptable('absent')).toBe(false);
  });

  it('fails closed on an unreachable key host', () => {
    expect(signatureIsAcceptable(entry('unreachable'))).toBe(false);
  });

  it('fails closed on a present-but-invalid signature', () => {
    expect(signatureIsAcceptable(entry('invalid'))).toBe(false);
  });

  it('rejects a signature verified under a non-pinned key', () => {
    expect(signatureIsAcceptable(entry('verified', false))).toBe(false);
  });

  it('accepts a signature verified under the pinned key', () => {
    expect(signatureIsAcceptable(entry('verified', true))).toBe(true);
  });

  it('still ignores a missing artefact (single-snapshot boot)', () => {
    expect(signatureIsAcceptable(null)).toBe(true);
  });
});

describe('pinGatesOk', () => {
  const mutableConfig = config as MutablePins;

  afterEach(() => {
    delete mutableConfig.pinnedPlatformKeys;
    delete mutableConfig.pinnedIssuerKeys;
  });

  it('passes both gates when nothing is pinned', () => {
    const gates = pinGatesOk([entry('verified')]);
    expect(gates.pinOk).toBe(true);
    expect(gates.issuerPinOk).toBe(true);
  });

  it('treats empty pin sets as unpinned', () => {
    mutableConfig.pinnedPlatformKeys = [];
    mutableConfig.pinnedIssuerKeys = [];
    const gates = pinGatesOk([entry('verified')]);
    expect(gates.pinOk).toBe(true);
    expect(gates.issuerPinOk).toBe(true);
  });

  it('requires a platform-pinned entry when platform keys are pinned', () => {
    mutableConfig.pinnedPlatformKeys = ['z6MkRoot'];
    expect(pinGatesOk([entry('verified', false)]).pinOk).toBe(false);
    expect(pinGatesOk([entry('verified', true)]).pinOk).toBe(true);
  });

  it('requires an issuer-pinned entry when issuer keys are pinned', () => {
    mutableConfig.pinnedIssuerKeys = ['z6MkByok'];
    expect(pinGatesOk([entry('verified', true, false)]).issuerPinOk)
      .toBe(false);
    expect(pinGatesOk([entry('verified', false, true)]).issuerPinOk)
      .toBe(true);
  });

  it('judges the two gates independently', () => {
    mutableConfig.pinnedPlatformKeys = ['z6MkRoot'];
    mutableConfig.pinnedIssuerKeys = ['z6MkByok'];
    const gates = pinGatesOk([
      entry('verified', true, false),
      entry('verified', false, true),
    ]);
    expect(gates.pinOk).toBe(true);
    expect(gates.issuerPinOk).toBe(true);

    const platformOnly = pinGatesOk([entry('verified', true, false)]);
    expect(platformOnly.pinOk).toBe(true);
    expect(platformOnly.issuerPinOk).toBe(false);
  });
});

describe('armRevocationGuard', () => {
  beforeEach(() => {
    versionStates.set({});
    revocationStatus.set('pending');
  });

  it('forces stored verified verdicts to failed once revoked', () => {
    versionStates.set({
      1: { status: 'verified', result: RESULT, chain: { status: 'ok' } },
      2: { status: 'pending' },
    });

    armRevocationGuard();
    revocationStatus.set('revoked');

    const states = versionStates.peek();
    expect(states[1].status).toBe('failed');
    expect((states[1] as { reason: string }).reason).toContain('revoked');

    // A version that had not yet verified is left untouched.
    expect(states[2].status).toBe('pending');
  });

  it('also fails stored verdicts when the list is unreachable', () => {
    // 'unreachable' only occurs on pinned builds, where the
    // network attacker the pin defends against could block
    // the revocation fetch; it must fail closed like
    // 'revoked' does.
    versionStates.set({
      1: { status: 'verified', result: RESULT, chain: { status: 'ok' } },
    });

    armRevocationGuard();
    revocationStatus.set('unreachable');

    const states = versionStates.peek();
    expect(states[1].status).toBe('failed');
    expect((states[1] as { reason: string }).reason).
      toContain('unreachable');
  });
});
