/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A publisher may republish a version URL: the demo
 * publisher is rebuilt hourly, minting a new signing key and re-emitting
 * every artefact under the same URLs. A returning visitor's
 * browser then holds the previous publish in its HTTP cache,
 * and those bytes still render while no longer matching the
 * revalidated manifest or verifying under the new key.
 *
 * ensureVersionLoaded must discard them: read past the HTTP
 * cache, re-judge, and surface only the verdict on the fresh
 * bytes. A failed badge may never describe bytes the browser
 * had lying around.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/crypto/dispatch', () => ({
  verifySnapshotAnySuite: vi.fn(),
}));

// Only the manifest signature verdict is stubbed; the rest
// of the module (hashing included) stays real.
vi.mock('@/crypto/verify', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/crypto/verify')>(),
  verifyManifestSignature: vi.fn(),
}));

import { verifySnapshotAnySuite } from '@/crypto/dispatch';
import {
  hexHashOfSnapshotBody, verifyManifestSignature,
} from '@/crypto/verify';
import type {
  ProofEntryResult, VerificationResult,
} from '@/crypto/verify';
import type { SignedSnapshot } from '@/archive';
import * as host from '@/host';
import {
  ensureVersionLoaded, resetVerifyCaches, retryFailedVersions,
} from '@/actions';
import { versionStates } from '@/state';
import { config } from '@/config';

const MANIFEST_URL = 'https://cdn.test/d/manifest.json';

const AUTHENTIC: VerificationResult = {
  entries: [], verdict: 'authentic', verifiedAuthorityCount: 2,
  totalEntryCount: 2, verifiedEntryCount: 2, mode: 'default',
};
const UNAUTHENTICATED: VerificationResult = {
  ...AUTHENTIC, verdict: 'unauthenticated',
  verifiedAuthorityCount: 0, verifiedEntryCount: 0,
};

// What the origin serves now, and the previous publish the
// browser still replays from its HTTP cache.
interface Publish {
  readonly fresh: Record<string, unknown>
  readonly stale: Record<string, unknown>
}

function publishOf(version: number, priorVersionHash?: string): Publish {
  const base = { version, proof: [],
    ...(priorVersionHash ? { priorVersionHash } : {}) };
  return {
    fresh: { ...base, publishedAt: '2026-01-01T01:00:00Z',
      passportAlias: `fresh-v${version}` },
    stale: { ...base, publishedAt: '2026-01-01T00:00:00Z',
      passportAlias: `stale-v${version}` },
  };
}

const V1 = publishOf(1);

function versionEntry(number: number, hashValue?: string): unknown {
  return {
    number, url: `/d/v/${number}.json`, publishedAt: null,
    reason: 'created', sizeBytes: 0,
    ...(hashValue ? { hashValue } : {}),
  };
}

function manifestOf(currentVersion: number, versions: unknown[]): unknown {
  return {
    '@type': 'DppManifest', code: 'dpp-demo', currentVersion,
    versions, epcisUrl: '/d/epcis.json',
  };
}

interface Call {
  readonly url: string
  readonly cache?: RequestCache
}

// Model the HTTP cache: a default fetch of a version URL
// replays that version's previous publish, only a
// cache-busting one reaches the origin. `origin.failures`
// makes that many origin reads fail before it recovers.
function stubFetch(
  manifest: unknown, publishes: Record<number, Publish>,
  origin: { failures?: number } = {},
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (
    input: string | URL, init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, cache: init?.cache });
    if (url.includes('/d/manifest.json')) return json(manifest);
    if (url.includes('/d/epcis.json')) return json({ epcisBody: {} });
    const version = url.match(/\/d\/v\/(\d+)\.json/)?.[1];
    const publish = version ? publishes[Number(version)] : undefined;
    if (!publish) return new Response('not found', { status: 404 });
    if (init?.cache === 'reload' && (origin.failures ?? 0) > 0) {
      origin.failures = (origin.failures ?? 0) - 1;
      return new Response('unavailable', { status: 503 });
    }
    return json(init?.cache === 'reload' ? publish.fresh : publish.stale);
  });
  return calls;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

// Verdict per bytes: the previous publish was signed under
// the key the rebuild threw away.
function rejectStalePublishes(): void {
  vi.mocked(verifySnapshotAnySuite).mockImplementation(
    async (doc: Record<string, unknown>) =>
      (String(doc.passportAlias).startsWith('fresh')
        ? AUTHENTIC
        : UNAUTHENTICATED),
  );
}

function callsFor(calls: Call[], version: number): Call[] {
  return calls.filter((c) => c.url.includes(`/d/v/${version}.json`));
}

interface Settled {
  readonly status: string
  readonly reason?: string
}

async function settledState(version = 1): Promise<Settled> {
  ensureVersionLoaded(version);
  await vi.waitFor(() => {
    expect(versionStates.peek()[version]?.status).not.toBe('pending');
  });
  return versionStates.peek()[version] as Settled;
}

function hashOf(body: Record<string, unknown>): Promise<string> {
  return hexHashOfSnapshotBody(body as unknown as SignedSnapshot);
}

beforeEach(() => {
  vi.stubGlobal('window', { location: { href: 'https://page.test/' } });
  versionStates.set({});
  resetVerifyCaches();
  vi.mocked(verifySnapshotAnySuite).mockResolvedValue(AUTHENTIC);

  // An unsigned manifest: resolves to 'absent', which the
  // unpinned tests tolerate, matching the real verifier on
  // a manifest with no signature block.
  vi.mocked(verifyManifestSignature).mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(verifySnapshotAnySuite).mockReset();
  vi.mocked(verifyManifestSignature).mockReset();
});

describe('ensureVersionLoaded on a republished version URL', () => {
  it('reads past the HTTP cache when the cached bytes fail', async () => {
    // The manifest makes no hash claim here, so the stale
    // bytes are caught by the proof alone.
    const manifest = manifestOf(1, [versionEntry(1)]);
    const calls = stubFetch(manifest, { 1: V1 });
    rejectStalePublishes();
    await host.bootFrom(MANIFEST_URL);

    const state = await settledState();

    expect(state.status).toBe('verified');
    expect(callsFor(calls, 1).map((c) => c.cache)).
      toEqual(['default', 'reload']);
  });

  it('renders the refetched bytes, not the cached ones', async () => {
    stubFetch(manifestOf(1, [versionEntry(1)]), { 1: V1 });
    rejectStalePublishes();
    await host.bootFrom(MANIFEST_URL);

    await settledState();

    expect(host.snapshots.peek()[1].code).toBe('fresh-v1');
  });

  // The rebuild that keeps its signing key: the cached bytes
  // still verify against their own proof, so only the
  // manifest's hashValue reveals that they are a previous
  // publish. Without that gate the visitor reads last hour's
  // passport under a green badge.
  it('reads past the cache when the bytes miss the manifest hash', async () => {
    const manifest = manifestOf(1, [versionEntry(1, await hashOf(V1.fresh))]);
    const calls = stubFetch(manifest, { 1: V1 });
    await host.bootFrom(MANIFEST_URL);

    const state = await settledState();

    expect(state.status).toBe('verified');
    expect(host.snapshots.peek()[1].code).toBe('fresh-v1');
    expect(callsFor(calls, 1).map((c) => c.cache)).
      toEqual(['default', 'reload']);
  });

  it('fails the verdict once the fresh bytes fail too', async () => {
    const stuck = { fresh: V1.stale, stale: V1.stale };
    const calls = stubFetch(manifestOf(1, [versionEntry(1)]), { 1: stuck });
    rejectStalePublishes();
    await host.bootFrom(MANIFEST_URL);

    const state = await settledState();

    expect(state.status).toBe('failed');

    // Exactly one retry: the refetched verdict is final.
    expect(callsFor(calls, 1).map((c) => c.cache)).
      toEqual(['default', 'reload']);
  });

  it('names the manifest hash claim when fresh bytes miss it', async () => {
    const stuck = { fresh: V1.stale, stale: V1.stale };
    const manifest = manifestOf(1, [versionEntry(1, await hashOf(V1.fresh))]);
    stubFetch(manifest, { 1: stuck });
    await host.bootFrom(MANIFEST_URL);

    const state = await settledState();

    expect(state.status).toBe('failed');
    expect(state.reason).toMatch(/does not hash to the manifest claim/);
  });

  it('leaves an accepted version on a single fetch', async () => {
    const manifest = manifestOf(1, [versionEntry(1, await hashOf(V1.stale))]);
    const calls = stubFetch(manifest, { 1: V1 });
    await host.bootFrom(MANIFEST_URL);

    const state = await settledState();

    expect(state.status).toBe('verified');
    expect(callsFor(calls, 1).map((c) => c.cache)).toEqual(['default']);
  });
});

describe('reading a version history past the HTTP cache', () => {
  it('re-reads each version from the origin once per boot', async () => {
    // Two republished versions. v2's chain walk needs v1's
    // bytes, and v1 is judged in its own right; the walk must
    // reuse the copy the origin already served rather than
    // download it a second time.
    const v1Hash = await hashOf(V1.fresh);
    const v2 = publishOf(2, v1Hash);
    const manifest = manifestOf(2, [
      versionEntry(1, v1Hash),
      versionEntry(2, await hashOf(v2.fresh)),
    ]);
    const calls = stubFetch(manifest, { 1: V1, 2: v2 });
    rejectStalePublishes();
    await host.bootFrom(MANIFEST_URL);

    expect((await settledState(1)).status).toBe('verified');
    expect((await settledState(2)).status).toBe('verified');

    expect(callsFor(calls, 1).map((c) => c.cache)).
      toEqual(['default', 'reload']);
    expect(callsFor(calls, 2).map((c) => c.cache)).
      toEqual(['default', 'reload']);
  });

  it('shares one origin read between concurrent walkers', async () => {
    const v1Hash = await hashOf(V1.fresh);
    const v2 = publishOf(2, v1Hash);
    const manifest = manifestOf(2, [
      versionEntry(1, v1Hash),
      versionEntry(2, await hashOf(v2.fresh)),
    ]);
    const calls = stubFetch(manifest, { 1: V1, 2: v2 });
    rejectStalePublishes();
    await host.bootFrom(MANIFEST_URL);

    // Both judges start before either settles: v2's fresh
    // chain walk wants v1's origin bytes at the same time as
    // v1's own judging pass.
    ensureVersionLoaded(2);
    ensureVersionLoaded(1);
    await vi.waitFor(() => {
      expect(versionStates.peek()[1]?.status).toBe('verified');
      expect(versionStates.peek()[2]?.status).toBe('verified');
    });

    const reloads = (n: number): number => callsFor(calls, n).
      filter((c) => c.cache === 'reload').length;
    expect(reloads(1)).toBe(1);
    expect(reloads(2)).toBe(1);
  });
});

// retryFailedVersions is what the proof modal's re-verify
// button calls: it drops the failed states along with what
// the failed pass concluded from, then judges again.
describe('retrying a failed verdict', () => {
  it('reads past the cache again on a retried failure', async () => {
    const publishes: Record<number, Publish> = {
      1: { fresh: V1.stale, stale: V1.stale },
    };
    const calls = stubFetch(manifestOf(1, [versionEntry(1)]), publishes);
    rejectStalePublishes();
    await host.bootFrom(MANIFEST_URL);
    expect((await settledState()).status).toBe('failed');

    // The origin is fixed between the failure and the click.
    publishes[1] = V1;
    retryFailedVersions();

    expect((await settledState()).status).toBe('verified');
    expect(callsFor(calls, 1).map((c) => c.cache)).
      toEqual(['default', 'reload', 'reload']);
  });

  it('keeps a version eligible after its origin read fails', async () => {
    const calls = stubFetch(
      manifestOf(1, [versionEntry(1)]), { 1: V1 }, { failures: 1 },
    );
    rejectStalePublishes();
    await host.bootFrom(MANIFEST_URL);
    expect((await settledState()).status).toBe('failed');

    retryFailedVersions();

    expect((await settledState()).status).toBe('verified');
    expect(callsFor(calls, 1).map((c) => c.cache)).
      toEqual(['default', 'reload', 'reload']);
  });

  // The manifest gate can fail transiently too (pinned build,
  // key host briefly unreachable); the retry must re-run the
  // memoized manifest verify rather than replay its verdict.
  it('re-verifies the manifest signature on retry', async () => {
    const entryOf = (
      status: 'unreachable' | 'verified',
    ): ProofEntryResult => ({
      index: 0, verificationMethod: '', proofValue: '',
      pinned: status === 'verified', issuerPinned: false, status,
    });
    vi.mocked(verifyManifestSignature).
      mockResolvedValueOnce(entryOf('unreachable')).
      mockResolvedValue(entryOf('verified'));
    vi.mocked(verifySnapshotAnySuite).mockResolvedValue({
      ...AUTHENTIC, entries: [entryOf('verified')],
    });
    const pins = config as { pinnedPlatformKeys?: ReadonlyArray<string> };
    pins.pinnedPlatformKeys = ['z6MkPinnedPlatform'];
    try {
      stubFetch(manifestOf(1, [versionEntry(1)]), { 1: V1 });
      await host.bootFrom(MANIFEST_URL);

      const first = await settledState();
      expect(first.status).toBe('failed');
      expect(first.reason).toMatch(/version list is unauthenticated/);

      retryFailedVersions();

      expect((await settledState()).status).toBe('verified');
    } finally {
      delete pins.pinnedPlatformKeys;
    }
  });
});

describe('boot artefact revalidation', () => {
  it('revalidates the mutable artefacts, not the version bytes', async () => {
    const calls = stubFetch(manifestOf(1, [versionEntry(1)]), { 1: V1 });
    await host.bootFrom(MANIFEST_URL);

    const cacheModeOf = (part: string): RequestCache | undefined =>
      calls.find((c) => c.url.includes(part))?.cache;

    expect(cacheModeOf('/d/manifest.json')).toBe('no-cache');
    expect(cacheModeOf('/d/epcis.json')).toBe('no-cache');
    expect(cacheModeOf('/d/v/1.json')).toBe('default');
  });
});
