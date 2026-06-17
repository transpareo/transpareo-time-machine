/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * bootFrom's reboot contract: a later `src` boot clears
 * every host cache up front, and async work started under
 * a previous boot (a slow manifest fetch, a lazy snapshot
 * fetch) detects the epoch change and drops its result
 * instead of writing the previous DPP's data into the
 * fresh caches.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

type HostModule = typeof import('../src/host');

function manifestOf(code: string, prefix: string): unknown {
  return {
    '@type': 'DppManifest',
    code,
    currentVersion: 1,
    versions: [{ number: 1, url: `${prefix}/v/1.json`, hashValue: 'h1' }],
    epcisUrl: `${prefix}/epcis.json`,
  };
}

function snapshotOf(alias: string): unknown {
  return { version: 1, publishedAt: '2026-01-01T00:00:00Z',
    passportAlias: alias };
}

const EPCIS = { epcisBody: { eventList: [] } };

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

// Route fetches by URL substring; values are either a
// payload (served immediately) or a deferred promise the
// test resolves later.
type Route = unknown | Promise<unknown>;

function stubFetch(routes: Record<string, Route>): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    for (const [key, value] of Object.entries(routes)) {
      if (url.includes(key)) {
        const payload = await value;
        return new Response(JSON.stringify(payload), { status: 200 });
      }
    }
    return new Response('not found', { status: 404 });
  });
  return calls;
}

async function freshHost(): Promise<HostModule> {
  vi.resetModules();
  vi.stubGlobal('window', {
    location: { href: 'https://page.test/' },
  });
  return import('../src/host');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bootFrom', () => {
  it('boots a manifest into ready', async () => {
    const host = await freshHost();
    stubFetch({
      '/a/manifest.json': manifestOf('dpp-a', '/a'),
      '/a/v/1.json': snapshotOf('alias-a'),
      '/a/epcis.json': EPCIS,
    });

    await host.bootFrom('https://cdn.test/a/manifest.json');

    expect(host.loadState.peek()).toBe('ready');
    expect(host.manifest.peek()?.code).toBe('dpp-a');
    expect(host.snapshots.peek()[1].code).toBe('alias-a');
  });

  it('a reboot clears the previous boot artefacts', async () => {
    const host = await freshHost();
    stubFetch({
      '/a/manifest.json': manifestOf('dpp-a', '/a'),
      '/a/v/1.json': snapshotOf('alias-a'),
      '/a/epcis.json': EPCIS,
      '/b/manifest.json': manifestOf('dpp-b', '/b'),
      '/b/v/1.json': snapshotOf('alias-b'),
      '/b/epcis.json': EPCIS,
    });

    await host.bootFrom('https://cdn.test/a/manifest.json');
    await host.bootFrom('https://cdn.test/b/manifest.json');

    // Same version number, different DPP: the cache must
    // hold B's snapshot, not A's leftover.
    expect(host.manifest.peek()?.code).toBe('dpp-b');
    expect(host.snapshots.peek()[1].code).toBe('alias-b');
    expect(Object.keys(host.rawSnapshots.peek())).toEqual(['1']);
  });

  it('a stale slow boot cannot overwrite a newer one', async () => {
    const host = await freshHost();
    const slowManifest = deferred<unknown>();
    const calls = stubFetch({
      '/a/manifest.json': slowManifest.promise,
      '/a/v/1.json': snapshotOf('alias-a'),
      '/a/epcis.json': EPCIS,
      '/b/manifest.json': manifestOf('dpp-b', '/b/v/1.json'),
      '/b/v/1.json': snapshotOf('alias-b'),
      '/b/epcis.json': EPCIS,
    });

    const first = host.bootFrom('https://cdn.test/a/manifest.json');
    await host.bootFrom('https://cdn.test/b/manifest.json');

    slowManifest.resolve(manifestOf('dpp-a', '/a'));
    await first;

    expect(host.loadState.peek()).toBe('ready');
    expect(host.manifest.peek()?.code).toBe('dpp-b');
    expect(host.snapshots.peek()[1].code).toBe('alias-b');

    // The stale boot bailed before fetching its snapshot
    // and EPCIS artefacts.
    expect(calls.filter((u) => u.includes('/a/v/1.json'))).toEqual([]);
  });

  it('a stale lazy snapshot fetch is dropped on reboot', async () => {
    const host = await freshHost();
    const slowSnapshot = deferred<unknown>();

    // Manifest A claims a second version that resolves
    // slowly; the reboot lands while it is in flight.
    const manifestA = {
      '@type': 'DppManifest',
      code: 'dpp-a',
      currentVersion: 1,
      versions: [
        { number: 1, url: '/a/v/1.json', hashValue: 'h1' },
        { number: 2, url: '/a/v/2.json', hashValue: 'h2' },
      ],
      epcisUrl: '/a/epcis.json',
    };
    stubFetch({
      '/a/manifest.json': manifestA,
      '/a/v/1.json': snapshotOf('alias-a'),
      '/a/v/2.json': slowSnapshot.promise,
      '/a/epcis.json': EPCIS,
      '/b/manifest.json': manifestOf('dpp-b', '/b'),
      '/b/v/1.json': snapshotOf('alias-b'),
      '/b/epcis.json': EPCIS,
    });

    await host.bootFrom('https://cdn.test/a/manifest.json');
    const lazy = host.fetchSnapshot(2);

    await host.bootFrom('https://cdn.test/b/manifest.json');
    slowSnapshot.resolve({ version: 2,
      publishedAt: '2026-02-01T00:00:00Z', passportAlias: 'stale-a' });

    expect(await lazy).toBeNull();
    expect(host.snapshots.peek()[2]).toBeUndefined();
    expect(host.snapshots.peek()[1].code).toBe('alias-b');
  });
});
