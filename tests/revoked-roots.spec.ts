/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The revoked-roots kill-switch compares a pinned key's
 * SHA-256 fingerprint against a published revocation feed.
 * normalizeFingerprint reconciles the feed's formats
 * (with/without the `sha256:` prefix, mixed case) so a
 * genuine match is never missed on a formatting nuance.
 *
 * startRevokedRootsCheck settles the revocationStatus
 * signal: 'ok' on a clean feed, 'revoked' on a fingerprint
 * match, and 'unreachable' once a retry also fails (pinned
 * builds fail closed on 'unreachable', so one transient
 * blip must not brick the page) or at once on a document
 * that is no revocation list.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeFingerprint } from '../src/revoked-roots';
import { encodeMultibaseBase58 } from '../src/crypto/multibase';

describe('normalizeFingerprint', () => {
  it('strips the sha256: algorithm prefix', () => {
    expect(normalizeFingerprint('sha256:abc123')).toBe('abc123');
  });

  it('lower-cases the hex', () => {
    expect(normalizeFingerprint('ABC123DEF')).toBe('abc123def');
    expect(normalizeFingerprint('sha256:ABCDEF')).toBe('abcdef');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeFingerprint('  abc123  ')).toBe('abc123');
    expect(normalizeFingerprint('  SHA256:ABC  ')).toBe('abc');
  });

  it('leaves an already-normalized, prefix-less hex unchanged', () => {
    expect(normalizeFingerprint('deadbeef')).toBe('deadbeef');
  });
});

// ─── startRevokedRootsCheck ──────────────────────────

const PIN_BYTES = (() => {
  const bytes = new Uint8Array(34).fill(7);
  bytes[0] = 0xed;
  bytes[1] = 0x01;
  return bytes;
})();
const PIN = encodeMultibaseBase58(PIN_BYTES);

async function pinFingerprint(): Promise<string> {
  const buf = new ArrayBuffer(PIN_BYTES.byteLength);
  new Uint8Array(buf).set(PIN_BYTES);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function feedResponse(fingerprints: string[]): Response {
  return new Response(JSON.stringify({
    revokedRoots: fingerprints.map((fingerprint) => ({ fingerprint })),
  }), { status: 200 });
}

// Fresh module registry per boot, so each one starts from a
// config holding only the settings it names.
type RevokedRootsModule = typeof import('../src/revoked-roots');

async function bootWithFetch(
  fetchImpl: (input?: string | URL) => Promise<Response>,
  pins: string[] = [PIN],
  settings: { assetHost?: string, revokedRootsUrl?: string } = {},
): Promise<RevokedRootsModule> {
  vi.resetModules();
  vi.stubGlobal('fetch', fetchImpl);
  vi.stubGlobal('window', {
    location: { href: 'https://shop.example/dpp/demo-2026-t001' },
  });
  const { config } = await import('../src/config');
  Object.assign(config, { pinnedPlatformKeys: pins, ...settings });
  const mod = await import('../src/revoked-roots');
  mod.startRevokedRootsCheck();
  return mod;
}

async function settledStatus(
  mod: RevokedRootsModule,
): Promise<string> {
  await vi.waitFor(() => {
    expect(mod.revocationStatus.peek()).not.toBe('pending');
  }, { timeout: 6000 });
  return mod.revocationStatus.peek();
}

describe('startRevokedRootsCheck', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('settles ok on a feed without a matching fingerprint', async () => {
    let calls = 0;
    const mod = await bootWithFetch(async () => {
      calls++;
      return feedResponse(['sha256:0000']);
    });
    expect(await settledStatus(mod)).toBe('ok');
    expect(calls).toBe(1);
  });

  it('settles revoked on a fingerprint match', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fp = await pinFingerprint();
    const mod = await bootWithFetch(async () => {
      return feedResponse([`sha256:${fp}`]);
    });
    expect(await settledStatus(mod)).toBe('revoked');
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/key is revoked/);
  });

  // The next element started its own check: the one before
  // settles nothing and logs nothing, whatever it reads.
  it.each([
    ['naming a pin revoked', async () => (
      feedResponse([`sha256:${await pinFingerprint()}`])
    )],
    ['that is no revocation list', async () => (
      new Response('null', { status: 200 })
    )],
  ])('drops a stale check %s, unlogged', async (_, list) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let release: ((res: Response) => void) | undefined;
    const mod = await bootWithFetch(() => new Promise<Response>((r) => {
      release = r;
    }));
    await vi.waitFor(() => expect(release).toBeDefined());

    const { config } = await import('../src/config');
    Object.assign(config, { pinnedPlatformKeys: undefined });
    mod.startRevokedRootsCheck();
    release?.(await list());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mod.revocationStatus.peek()).toBe('unpinned');
    expect(warn).not.toHaveBeenCalled();
  });

  it('settles revoked when any key of the pin set matches', async () => {
    // A rotated build pins several roots (current first,
    // retired after). A feed listing only a retired pin
    // still kills the page: the shell should have dropped
    // that key, so a hit means the shell or bundle is
    // stale.
    const fresh = encodeMultibaseBase58((() => {
      const bytes = new Uint8Array(34).fill(9);
      bytes[0] = 0xed;
      bytes[1] = 0x01;
      return bytes;
    })());
    const fp = await pinFingerprint();
    const mod = await bootWithFetch(async () => {
      return feedResponse([`sha256:${fp}`]);
    }, [fresh, PIN]);
    expect(await settledStatus(mod)).toBe('revoked');
  });

  it('retries once: transient failure then success is ok', async () => {
    let calls = 0;
    const mod = await bootWithFetch(async () => {
      calls++;
      if (calls === 1) throw new Error('connection reset');
      return feedResponse([]);
    });
    expect(await settledStatus(mod)).toBe('ok');
    expect(calls).toBe(2);
  }, 8000);

  // A page without asset-host behaves as before the
  // attribute existed, wherever its src points.
  it('reads transpareo.com without asset-host', async () => {
    const urls: string[] = [];
    const mod = await bootWithFetch(async (input?: string | URL) => {
      urls.push(String(input));
      return feedResponse([]);
    });
    expect(await settledStatus(mod)).toBe('ok');
    expect(urls).toEqual([
      'https://transpareo.com/.well-known/dpp-revoked-roots.json',
    ]);
  });

  it('reads the list from a named asset host', async () => {
    const urls: string[] = [];
    const mod = await bootWithFetch(async (input?: string | URL) => {
      urls.push(String(input));
      return feedResponse([]);
    }, [PIN], { assetHost: 'https://cdn.example' });
    expect(await settledStatus(mod)).toBe('ok');
    expect(urls).toEqual([
      'https://cdn.example/.well-known/dpp-revoked-roots.json',
    ]);
  });

  it('reads it from the page origin under asset-host "/"', async () => {
    const urls: string[] = [];
    const mod = await bootWithFetch(async (input?: string | URL) => {
      urls.push(String(input));
      return feedResponse([]);
    }, [PIN], { assetHost: '/' });
    expect(await settledStatus(mod)).toBe('ok');
    expect(urls).toEqual([
      'https://shop.example/.well-known/dpp-revoked-roots.json',
    ]);
  });

  // No URL to read the list from leaves the pins as unjudged
  // as a list that will not load, and asking again builds none.
  it.each(['data:x', 'mailto:x'])(
    'settles unreachable on an asset host %s no path resolves against',
    async (assetHost) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let calls = 0;
      const mod = await bootWithFetch(async () => {
        calls++;
        return feedResponse([]);
      }, [PIN], { assetHost });
      expect(await settledStatus(mod)).toBe('unreachable');
      expect(calls).toBe(0);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/is no base for/);
    }
  );

  it('prefers revoked-roots-src over the asset host', async () => {
    const urls: string[] = [];
    const mod = await bootWithFetch(async (input?: string | URL) => {
      urls.push(String(input));
      return feedResponse([]);
    }, [PIN], {
      assetHost: 'https://cdn.example',
      revokedRootsUrl: 'https://forks.example/revoked.json',
    });
    expect(await settledStatus(mod)).toBe('ok');
    expect(urls).toEqual(['https://forks.example/revoked.json']);
  });

  // A list of another shape clears the pins no more than one
  // that will not load. Read again, it has the same shape, so
  // it is read once.
  it.each([
    ['null', null],
    ['a top-level array', []],
    ['a revokedRoots that is not an array', { revokedRoots: 5 }],
    ['a revokedRoots string', { revokedRoots: 'sha256:00' }],
    ['an entry that is not an object', { revokedRoots: [null] }],
    ['a fingerprint that is not a string',
      { revokedRoots: [{ fingerprint: 7 }] }],
  ])('settles unreachable on %s', async (_, body) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const mod = await bootWithFetch(async () => {
      calls++;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    expect(await settledStatus(mod)).toBe('unreachable');
    expect(calls).toBe(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/no revocation list/);
  });

  // An entry naming no fingerprint names no key, and a list
  // without entries revokes none.
  it.each([
    ['without revokedRoots', {}],
    ['whose entries name no fingerprint',
      { revokedRoots: [{}, { fingerprint: null }, { fingerprint: '' }] }],
  ])('settles ok on a list %s', async (_, body) => {
    const mod = await bootWithFetch(async () => (
      new Response(JSON.stringify(body), { status: 200 })
    ));
    expect(await settledStatus(mod)).toBe('ok');
  });

  it('settles unreachable only after both attempts fail', async () => {
    let calls = 0;
    const mod = await bootWithFetch(async () => {
      calls++;
      throw new Error('blocked');
    });
    expect(await settledStatus(mod)).toBe('unreachable');
    expect(calls).toBe(2);
  }, 8000);
});
