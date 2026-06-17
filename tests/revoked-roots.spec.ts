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
 * match, and 'unreachable' only after a retry also fails
 * (pinned builds fail closed on 'unreachable', so one
 * transient blip must not brick the page).
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

// Fresh module registry per boot: the check is one-shot
// behind a module-level `started` latch, and the signal
// must start back at 'pending'.
type RevokedRootsModule = typeof import('../src/revoked-roots');

async function bootWithFetch(
  fetchImpl: () => Promise<Response>,
  pins: string[] = [PIN],
): Promise<RevokedRootsModule> {
  vi.resetModules();
  vi.stubGlobal('fetch', fetchImpl);
  const { config } = await import('../src/config');
  (config as { pinnedPlatformKeys?: string[] }).pinnedPlatformKeys = pins;
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
    const fp = await pinFingerprint();
    const mod = await bootWithFetch(async () => {
      return feedResponse([`sha256:${fp}`]);
    });
    expect(await settledStatus(mod)).toBe('revoked');
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
