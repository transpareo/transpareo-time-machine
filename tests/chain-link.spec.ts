/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * verifyChainLink walks the priorVersionHash chain: it
 * checks the snapshot's priorVersionHash against the
 * manifest's entry for the prior version AND recomputes the
 * prior body's hash from bytes, so neither the manifest nor
 * a snapshot can lie about the link alone. The host module
 * is mocked to control the manifest + raw-snapshot caches;
 * the SHA-256 hashing runs for real.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/host', () => ({
  manifest: { peek: vi.fn(() => null) },
  rawSnapshots: { peek: vi.fn(() => ({})) },
  snapshots: { peek: vi.fn(() => ({})) },
  epcisDocument: { peek: vi.fn(() => null) },
  fetchSnapshot: vi.fn(async () => undefined),
}));

import * as host from '@/host';
import { verifyChainLink } from '@/actions';
import { hexHashOfSnapshotBody } from '@/crypto/verify';

type Rec = Record<string, unknown>;
const asSnap = (o: Rec) => o as never;
const manifestWith = (versions: Rec[]) => ({ versions }) as never;

beforeEach(() => {
  vi.mocked(host.manifest.peek).mockReturnValue(null as never);
  vi.mocked(host.rawSnapshots.peek).mockReturnValue({} as never);
  vi.mocked(host.fetchSnapshot).mockResolvedValue(undefined as never);
});

describe('verifyChainLink', () => {
  it('reports not-applicable for v1 (the chain root)', async () => {
    const res = await verifyChainLink(1, asSnap({ version: 1, proof: [] }));
    expect(res.status).toBe('not-applicable');
  });

  it('reports unknown when the manifest has not loaded', async () => {
    const res = await verifyChainLink(
      2, asSnap({ version: 2, proof: [], priorVersionHash: 'aa' }),
    );
    expect(res.status).toBe('unknown');
  });

  it('breaks when the manifest has no entry for the prior version', async () => {
    vi.mocked(host.manifest.peek).mockReturnValue(
      manifestWith([{ number: 5, hashValue: 'zz' }]),
    );
    const res = await verifyChainLink(
      2, asSnap({ version: 2, proof: [], priorVersionHash: 'aa' }),
    );
    expect(res.status).toBe('broken');
    expect(res.reason).toMatch(/no entry for v1/);
  });

  it('breaks when the snapshot omits priorVersionHash', async () => {
    vi.mocked(host.manifest.peek).mockReturnValue(
      manifestWith([{ number: 1, hashValue: 'aa' }]),
    );
    const res = await verifyChainLink(2, asSnap({ version: 2, proof: [] }));
    expect(res.status).toBe('broken');
    expect(res.reason).toMatch(/no priorVersionHash/);
  });

  it('breaks when priorVersionHash disagrees with the manifest entry', async () => {
    vi.mocked(host.manifest.peek).mockReturnValue(
      manifestWith([{ number: 1, hashValue: 'aa' }]),
    );
    const res = await verifyChainLink(
      2, asSnap({ version: 2, proof: [], priorVersionHash: 'bb' }),
    );
    expect(res.status).toBe('broken');
    expect(res.reason).toMatch(/does not match the manifest/);
  });

  it('is ok when the recomputed prior body hash matches both claims', async () => {
    const priorBody = {
      version: 1, publishedAt: 'x', proof: [{ proofValue: 'z1' }],
    };
    const h = await hexHashOfSnapshotBody(priorBody as never);
    vi.mocked(host.manifest.peek).mockReturnValue(
      manifestWith([{ number: 1, hashValue: h }]),
    );
    vi.mocked(host.rawSnapshots.peek).mockReturnValue({ 1: priorBody } as never);
    const res = await verifyChainLink(
      2, asSnap({ version: 2, proof: [], priorVersionHash: h }),
    );
    expect(res.status).toBe('ok');
  });

  it('breaks when the prior body does not hash to the claimed value', async () => {
    // priorVersionHash matches the manifest entry, but the
    // actual cached prior body hashes to something else.
    const claimed = await hexHashOfSnapshotBody({ version: 1, proof: [] } as never);
    const tamperedBody = { version: 1, proof: [], extra: 'tampered' };
    vi.mocked(host.manifest.peek).mockReturnValue(
      manifestWith([{ number: 1, hashValue: claimed }]),
    );
    vi.mocked(host.rawSnapshots.peek).mockReturnValue(
      { 1: tamperedBody } as never,
    );
    const res = await verifyChainLink(
      2, asSnap({ version: 2, proof: [], priorVersionHash: claimed }),
    );
    expect(res.status).toBe('broken');
    expect(res.reason).toMatch(/does not hash to the manifest claim/);
  });

  it('propagates a deeper unknown instead of upgrading it to ok', async () => {
    // v3 -> v2 verifies, but v2's prior (v1) is not
    // retrievable, so the tail of the chain was never
    // checked; the head must report unknown, not a green
    // "fully walked" tick.
    const v2body = { version: 2, proof: [], priorVersionHash: 'cc' };
    const h2 = await hexHashOfSnapshotBody(v2body as never);
    vi.mocked(host.manifest.peek).mockReturnValue(
      manifestWith([
        { number: 1, hashValue: 'cc' },
        { number: 2, hashValue: h2 },
      ]),
    );
    vi.mocked(host.rawSnapshots.peek).mockReturnValue({ 2: v2body } as never);
    const res = await verifyChainLink(
      3, asSnap({ version: 3, proof: [], priorVersionHash: h2 }),
    );
    expect(res.status).toBe('unknown');
    expect(res.reason).toMatch(/v1 not retrievable/);
  });
});
