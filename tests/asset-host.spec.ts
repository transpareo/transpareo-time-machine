/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Where root paths land. A signed passport names its files
 * by root path (`/acme/dpp/x/v/1-ab.json`), and the
 * `asset-host` attribute says which origin they are read
 * from: the CDN on a live page, the page's own origin in an
 * archive copy ("/"). Without the attribute the origin of
 * `src` serves. Absolute values stand as written, and a
 * path relative to its document resolves against that
 * document as before.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveReference } from '../src/host';

type HostModule = typeof import('../src/host');

const MANIFEST = {
  '@type': 'DppManifest',
  code: 'demo-2026-t001',
  currentVersion: 1,
  versions: [{
    number: 1, url: '/acme/dpp/demo-2026-t001/v/1-ab.json', hashValue: 'h1',
  }],
  epcisUrl: '/acme/dpp/demo-2026-t001/events.json',
  dynamicDataUrl: '/acme/dpp/demo-2026-t001/dynamic-data.json',
};

const SNAPSHOT = {
  version: 1,
  publishedAt: '2026-01-01T00:00:00Z',
  passportAlias: 'demo-2026-t001',
  product: {
    images: [{ thumbnail: '/media/acme/t.jpg', large: '/media/acme/l.jpg' }],
  },
};

// Answer by path, whatever the host: the assertions read the
// recorded URLs to see which host each request went to.
function stubFetch(manifest: unknown = MANIFEST): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push(url);
    const path = new URL(url).pathname;
    if (path.endsWith('/manifest.json')) return json(manifest);
    if (path.endsWith('/v/1-ab.json')) return json(SNAPSHOT);
    return json({});
  });
  return calls;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

async function freshHost(attrs: Record<string, string> = {}): Promise<
  HostModule
> {
  vi.resetModules();
  vi.stubGlobal('window', {
    location: { href: 'https://shop.example/dpp/demo-2026-t001' },
  });
  const { initConfigFromElement } = await import('../src/config');
  initConfigFromElement({
    getAttribute: (name: string) => attrs[name] ?? null,
    hasAttribute: (name: string) => name in attrs,
  } as unknown as Element);
  return import('../src/host');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('asset-host: the files a manifest names', () => {
  it('reads root paths from the asset host', async () => {
    const host = await freshHost({ 'asset-host': 'https://cdn.example' });
    const calls = stubFetch();

    await host.bootFrom('/acme/dpp/demo-2026-t001/manifest.json');

    expect(calls).toContain(
      'https://cdn.example/acme/dpp/demo-2026-t001/manifest.json',
    );
    expect(calls).toContain(
      'https://cdn.example/acme/dpp/demo-2026-t001/v/1-ab.json',
    );
    expect(calls).toContain(
      'https://cdn.example/acme/dpp/demo-2026-t001/events.json',
    );
    expect(calls).toContain(
      'https://cdn.example/acme/dpp/demo-2026-t001/dynamic-data.json',
    );
  });

  it('reads them from the origin of src without the attribute', async () => {
    const host = await freshHost();
    const calls = stubFetch();

    await host.bootFrom(
      'https://cdn.example/acme/dpp/demo-2026-t001/manifest.json',
    );

    expect(calls).toContain(
      'https://cdn.example/acme/dpp/demo-2026-t001/v/1-ab.json',
    );
  });

  // An archive copy: the page and the files share an origin,
  // whatever web root the folder was copied to.
  it('reads them from the page origin under "/"', async () => {
    const host = await freshHost({ 'asset-host': '/' });
    const calls = stubFetch();

    await host.bootFrom('/acme/dpp/demo-2026-t001/manifest.json');

    expect(calls).toEqual(expect.arrayContaining([
      'https://shop.example/acme/dpp/demo-2026-t001/manifest.json',
      'https://shop.example/acme/dpp/demo-2026-t001/v/1-ab.json',
    ]));
  });

  it('leaves an absolute src on its own host', async () => {
    const host = await freshHost({ 'asset-host': 'https://cdn.example' });
    const calls = stubFetch();

    await host.bootFrom(
      'https://other.example/acme/dpp/demo-2026-t001/manifest.json',
    );

    expect(calls[0]).toBe(
      'https://other.example/acme/dpp/demo-2026-t001/manifest.json',
    );
    expect(calls).toContain(
      'https://cdn.example/acme/dpp/demo-2026-t001/v/1-ab.json',
    );
  });

  it('reads a lazily loaded version from the asset host', async () => {
    const host = await freshHost({ 'asset-host': 'https://cdn.example' });
    const calls = stubFetch();
    await host.bootFrom('/acme/dpp/demo-2026-t001/manifest.json');
    calls.length = 0;

    await host.fetchSnapshot(1, { reload: true });

    expect(calls).toEqual([
      'https://cdn.example/acme/dpp/demo-2026-t001/v/1-ab.json',
    ]);
  });
});

describe('asset-host: references that are not root paths', () => {
  it('keeps an absolute URL as written', () => {
    const ref = 'https://cdn.old.example/acme/dpp/x/v/1.json';
    expect(
      resolveWith('https://cdn.example', ref, 'https://m.example/m.json'),
    ).toBe(ref);
  });

  it('resolves a path beside its document against that document', () => {
    expect(
      resolveWith('https://cdn.example', 'v/1.json', 'https://m.example/d/m.json'),
    ).toBe('https://m.example/d/v/1.json');
  });

  it('treats a scheme-relative URL as its document does', () => {
    expect(
      resolveWith('https://cdn.example', '//x.example/a.json', 'https://m.example/m.json'),
    ).toBe('https://x.example/a.json');
  });

  it('answers null for a reference no parser accepts', () => {
    expect(resolveWith('https://cdn.example', 'v/1.json', 'not a url'))
      .toBeNull();
  });
});

describe('asset-host: images', () => {
  // The version itself sits on another host, as an older
  // manifest names it: the images still follow the
  // attribute, not the document that carries them.
  it('reads root-path images from the asset host', async () => {
    const host = await freshHost({ 'asset-host': 'https://cdn.example' });
    const version = 'https://old-cdn.example/acme/dpp/demo-2026-t001/v/1-ab.json';
    const versions = [{ ...MANIFEST.versions[0], url: version }];
    stubFetch({ ...MANIFEST, versions });

    await host.bootFrom(
      'https://shop.example/dpp/demo-2026-t001/manifest.json',
    );

    expect(host.snapshots.peek()[1].product.images[0]).toEqual({
      thumbnail: 'https://cdn.example/media/acme/t.jpg',
      large: 'https://cdn.example/media/acme/l.jpg',
    });
  });
});

function resolveWith(
  assetHost: string, ref: string, documentUrl: string,
): string | null {
  return resolveReference(ref, documentUrl, `${assetHost}/`);
}
