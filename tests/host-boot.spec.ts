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
 *
 * And what the boot waits for. The events feed is fetched
 * beside the snapshot and not awaited: it feeds the
 * timeline, which is below the card and closed when the
 * page opens. A link into one event is the exception, and
 * a feed that never loads costs the history rather than
 * the passport.
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

describe('bootFrom and the events feed', () => {
  it('is ready before the feed lands', async () => {
    const host = await freshHost();
    const feed = deferred<unknown>();
    stubFetch({
      '/a/manifest.json': manifestOf('dpp-a', '/a'),
      '/a/v/1.json': snapshotOf('alias-a'),
      '/a/epcis.json': feed.promise,
    });

    await host.bootFrom('https://cdn.test/a/manifest.json');

    // The card can render: the snapshot is in and the feed
    // is still in flight.
    expect(host.loadState.peek()).toBe('ready');
    expect(host.epcisDocument.peek()).toBeNull();
    expect(host.eventsPending.peek()).toBe(true);

    feed.resolve(EPCIS);
    await vi.waitFor(() => {
      expect(host.epcisDocument.peek()).not.toBeNull();
    });
    expect(host.eventsPending.peek()).toBe(false);
  });

  it('renders the passport when the feed will not load', async () => {
    const host = await freshHost();
    stubFetch({
      '/a/manifest.json': manifestOf('dpp-a', '/a'),
      '/a/v/1.json': snapshotOf('alias-a'),
      // No route for the feed: it 404s.
    });

    await host.bootFrom('https://cdn.test/a/manifest.json');

    expect(host.loadState.peek()).toBe('ready');
    expect(host.snapshots.peek()[1].code).toBe('alias-a');
    await vi.waitFor(() => {
      expect(host.eventsPending.peek()).toBe(false);
    });
    expect(host.epcisDocument.peek()).toBeNull();
  });

  // A shared link into one event asks for the timeline
  // itself. Mounting before the feed lands would render the
  // current version and then jump to the linked one.
  it('waits for the feed when the URL names an event', async () => {
    vi.resetModules();
    vi.stubGlobal('window', {
      location: { href: 'https://page.test/#evt-7', hash: '#evt-7' },
    });
    const host: HostModule = await import('../src/host');
    const feed = deferred<unknown>();
    stubFetch({
      '/a/manifest.json': manifestOf('dpp-a', '/a'),
      '/a/v/1.json': snapshotOf('alias-a'),
      '/a/epcis.json': feed.promise,
    });

    let settled = false;
    const boot = host.bootFrom('https://cdn.test/a/manifest.json')
      .then(() => { settled = true; });

    await vi.waitFor(() => {
      expect(host.snapshots.peek()[1]).toBeDefined();
    });
    expect(settled).toBe(false);
    expect(host.loadState.peek()).toBe('loading');

    feed.resolve(EPCIS);
    await boot;
    expect(host.loadState.peek()).toBe('ready');
    expect(host.epcisDocument.peek()).not.toBeNull();
  });
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

  // The boot src may be the passport's own URL, where a
  // content-negotiating publisher decides HTML vs JSON by
  // the Accept header; every artefact fetch must ask for
  // JSON so that case never returns the HTML page.
  it('asks for JSON on every artefact fetch', async () => {
    const host = await freshHost();
    const accepts: Array<string | undefined> = [];
    const routes: Record<string, unknown> = {
      '/a/manifest.json': manifestOf('dpp-a', '/a'),
      '/a/v/1.json': snapshotOf('alias-a'),
      '/a/epcis.json': EPCIS,
    };
    vi.stubGlobal('fetch', async (
      input: string | URL, init?: RequestInit,
    ): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      accepts.push((init?.headers as Record<string, string>)?.accept);
      for (const [key, value] of Object.entries(routes)) {
        if (url.includes(key)) {
          return new Response(JSON.stringify(value), { status: 200 });
        }
      }
      return new Response('not found', { status: 404 });
    });

    await host.bootFrom('https://cdn.test/a/manifest.json');

    expect(host.loadState.peek()).toBe('ready');
    expect(accepts.length).toBeGreaterThan(0);
    for (const accept of accepts) {
      expect(accept).toBe('application/ld+json, application/json');
    }
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
