/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The widget's chain walk recomputes each prior snapshot's
 * body hash from its bytes and cross-checks it against both
 * the manifest's hashValue entry and the next snapshot's
 * priorVersionHash claim, so a re-emitted manifest with
 * matching forged hashes still fails on the recompute.
 */

import { describe, it, expect } from 'vitest';
import { verifyChainFromHead } from '../src/verifier-chain';
import { hexHashOfSnapshotBody } from '../src/crypto/verify';
import type { DppManifest, SignedSnapshot } from '../src/archive';

const MANIFEST_URL = 'https://cdn.test/dpp/manifest.json';

interface Fixture {
  manifest: DppManifest;
  head: SignedSnapshot;
  snapshots: Map<string, SignedSnapshot>;
  fetched: string[];
}

// A consistent 3-version chain; tests tamper with copies.
async function buildChain(): Promise<Fixture> {
  const v1: SignedSnapshot = { version: 1, publishedAt: '2026-01-01' };
  const h1 = await hexHashOfSnapshotBody(v1);
  const v2: SignedSnapshot = {
    version: 2, publishedAt: '2026-02-01', priorVersionHash: h1,
  };
  const h2 = await hexHashOfSnapshotBody(v2);
  const v3: SignedSnapshot = {
    version: 3, publishedAt: '2026-03-01', priorVersionHash: h2,
  };
  const h3 = await hexHashOfSnapshotBody(v3);

  const versionEntry = (number: number, hashValue: string) => ({
    number,
    publishedAt: null,
    reason: 'update',
    hashValue,
    url: `/dpp/v/${number}.json`,
    sizeBytes: 100,
  });
  const manifest = {
    currentVersion: 3,
    versions: [
      versionEntry(1, h1), versionEntry(2, h2), versionEntry(3, h3),
    ],
  } as unknown as DppManifest;

  const snapshots = new Map<string, SignedSnapshot>([
    ['https://cdn.test/dpp/v/1.json', v1],
    ['https://cdn.test/dpp/v/2.json', v2],
  ]);
  return { manifest, head: v3, snapshots, fetched: [] };
}

function fetcherOf(fx: Fixture) {
  return async (url: string): Promise<SignedSnapshot> => {
    fx.fetched.push(url);
    const snap = fx.snapshots.get(url);
    if (!snap) throw new Error(`404 ${url}`);
    return snap;
  };
}

describe('verifyChainFromHead', () => {
  it('walks a consistent chain down to v1', async () => {
    const fx = await buildChain();
    const res = await verifyChainFromHead(
      fx.manifest, MANIFEST_URL, fx.head, fetcherOf(fx),
    );
    expect(res.status).toBe('ok');
    expect(fx.fetched).toEqual([
      'https://cdn.test/dpp/v/2.json',
      'https://cdn.test/dpp/v/1.json',
    ]);
  });

  it('is not applicable on a single-version manifest', async () => {
    const fx = await buildChain();
    const manifest = {
      ...fx.manifest, currentVersion: 1,
    } as DppManifest;
    const res = await verifyChainFromHead(
      manifest, MANIFEST_URL, fx.snapshots.get(
        'https://cdn.test/dpp/v/1.json',
      )!, fetcherOf(fx),
    );
    expect(res.status).toBe('not-applicable');
    expect(fx.fetched).toEqual([]);
  });

  it('breaks when a snapshot omits priorVersionHash', async () => {
    const fx = await buildChain();
    const head = { ...fx.head } as Record<string, unknown>;
    delete head.priorVersionHash;
    const res = await verifyChainFromHead(
      fx.manifest, MANIFEST_URL, head as SignedSnapshot, fetcherOf(fx),
    );
    expect(res.status).toBe('broken');
    expect(res.reason).toContain('priorVersionHash');
  });

  it('breaks when the claim disagrees with the manifest', async () => {
    const fx = await buildChain();
    const head = {
      ...fx.head, priorVersionHash: 'f'.repeat(64),
    } as SignedSnapshot;
    const res = await verifyChainFromHead(
      fx.manifest, MANIFEST_URL, head, fetcherOf(fx),
    );
    expect(res.status).toBe('broken');
    expect(res.reason).toContain('does not match the manifest');
  });

  it('breaks when a prior body was re-emitted (recompute mismatch)', async () => {
    // Manifest claim and priorVersionHash agree, but the
    // hosted v2 bytes were swapped: only recomputing the
    // body hash catches this.
    const fx = await buildChain();
    const original = fx.snapshots.get('https://cdn.test/dpp/v/2.json')!;
    fx.snapshots.set('https://cdn.test/dpp/v/2.json', {
      ...original,
      tampered: true,
    });
    const res = await verifyChainFromHead(
      fx.manifest, MANIFEST_URL, fx.head, fetcherOf(fx),
    );
    expect(res.status).toBe('broken');
    expect(res.reason).toContain('does not hash');
  });

  it('breaks when the manifest is missing a prior entry', async () => {
    const fx = await buildChain();
    const manifest = {
      ...fx.manifest,
      versions: fx.manifest.versions.filter((v) => v.number !== 2),
    } as DppManifest;
    const res = await verifyChainFromHead(
      manifest, MANIFEST_URL, fx.head, fetcherOf(fx),
    );
    expect(res.status).toBe('broken');
    expect(res.reason).toContain('no entry for v2');
  });
});
