// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The version-checks disclosure subtitle picks between
 * three sentences: the pending notice, the generic
 * "verified against N keys" count, and the two-authorities
 * wording that names the issuer and the platform. The
 * naming variant must fire only for exactly one issuer key
 * plus one platform key (the ecdsa-sd two-proof shape); a
 * multi-alias eddsa proof set keeps the count sentence,
 * whose per-owner possessives would otherwise misstate the
 * key count.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as host from '../src/host';
import {
  buildDisclosureSubtitle, buildChainSection,
} from '../src/components/dpp-verification-modal';
import type { DppSnapshot } from '../src/types';
import type { VersionState } from '../src/archive';
import type { ProofEntryResult } from '../src/crypto/verify';

const ISSUER = 'Volturra Energia';
const PLATFORM = 'Transpareo';
const ISS_URL = 'https://cdn.example/p/keys/issuer.json';
const PLAT_URL = 'https://cdn.example/p/keys/platform.json';

// Grouping is by resolved key: aliases passed the same
// `key` collapse into one authority group, distinct keys
// stay separate.
function entry(method: string, key: string): ProofEntryResult {
  return {
    index: 0,
    verificationMethod: method,
    status: 'verified',
    proofValue: 'z1',
    keyMultibase: key,
  } as ProofEntryResult;
}

function verified(entries: ProofEntryResult[]): VersionState {
  return {
    status: 'verified',
    result: { entries },
    chain: { status: 'ok' },
  } as unknown as VersionState;
}

beforeEach(() => {
  host.currentVersion.set(4);
  host.snapshots.set({
    4: {
      issuer: { name: ISSUER },
      platform: { name: PLATFORM },
    } as unknown as DppSnapshot,
  });
});

describe('buildDisclosureSubtitle', () => {
  it('renders the pending notice without a state', () => {
    expect(buildDisclosureSubtitle(4, undefined).textContent).
      toBe('Verifying snapshot proofs in your browser...');
  });

  it('renders the pending notice while verifying', () => {
    expect(buildDisclosureSubtitle(4, { status: 'pending' }).textContent).
      toBe('Verifying snapshot proofs in your browser...');
  });

  it('breaks the count down per authority for one key each', () => {
    const state = verified([
      entry(ISS_URL, 'zIssuer'),
      entry(PLAT_URL, 'zPlatform'),
    ]);
    expect(buildDisclosureSubtitle(4, state).textContent).toBe(
      'Version v4 verified against 2 keys in your browser, '
      + '1 from the issuer (Volturra Energia) and 1 from Transpareo.',
    );
  });

  it('folds aliases into the per-authority counts', () => {
    const state = verified([
      entry(`${ISS_URL}#did-web`, 'zIss'),
      entry(`${ISS_URL}#cdn`, 'zIss'),
      entry(ISS_URL, 'zIss'),
      entry(`${PLAT_URL}#did-web`, 'zPlat'),
      entry(PLAT_URL, 'zPlat'),
    ]);
    expect(buildDisclosureSubtitle(6, state).textContent).toBe(
      'Version v6 verified against 5 keys in your browser, '
      + '3 from the issuer (Volturra Energia) and 2 from Transpareo.',
    );
  });

  it('uses the singular sentence for one key', () => {
    const state = verified([entry(ISS_URL, 'zIss')]);
    expect(buildDisclosureSubtitle(1, state).textContent).
      toBe('Version v1 verified against 1 key in your browser.');
  });

  it('falls back to the plain count without a platform group', () => {
    // Two distinct issuer keys and no platform: two groups, but
    // both are the issuer, so the per-authority wording (which
    // needs one issuer and one platform) does not apply.
    const state = verified([
      entry(ISS_URL, 'zIssA'),
      entry(`${ISS_URL}#did-web`, 'zIssB'),
    ]);
    expect(buildDisclosureSubtitle(2, state).textContent).
      toBe('Version v2 verified against 2 keys in your browser.');
  });

  it('keeps the same sentence on a failed verdict', () => {
    // "verified against" reads as "checked against": the
    // subtitle describes the check that ran, the rows below
    // carry the per-authority verdicts.
    const state = {
      status: 'failed',
      result: {
        entries: [entry(ISS_URL, 'zIss'), entry(PLAT_URL, 'zPlat')],
      },
      chain: { status: 'broken' },
      reason: 'signature mismatch',
    } as unknown as VersionState;
    expect(buildDisclosureSubtitle(4, state).textContent).toBe(
      'Version v4 verified against 2 keys in your browser, '
      + '1 from the issuer (Volturra Energia) and 1 from Transpareo.',
    );
  });
});

describe('buildChainSection', () => {
  function names(section: HTMLElement): (string | null)[] {
    return [...section.querySelectorAll('.proof-authority-name')].
      map((n) => n.textContent);
  }

  it('labels the issuer row generically, platform by name', () => {
    const section = buildChainSection(verified([
      entry(PLAT_URL, 'zPlat'),
      entry(ISS_URL, 'zIss'),
    ]));
    // Issuer ordered first, shown as the generic "Issuer"
    // rather than "Volturra Energia"; platform keeps its
    // short brand name.
    expect(names(section)).toEqual(['Issuer', 'Transpareo']);
  });

  it('renders the pending notice while verifying', () => {
    const section = buildChainSection({ status: 'pending' });
    expect(names(section)).toEqual([]);
    expect(section.textContent).
      toBe('Verifying snapshot proofs in your browser...');
  });
});
