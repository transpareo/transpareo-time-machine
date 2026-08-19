/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Coverage for src/crypto/did-web.ts: the verificationMethod
 * splitter's fail-closed scheme rules, and resolveMultikey's
 * fetch behaviour (a timeout signal is attached; aborting it
 * rejects rather than hanging forever), and the cache bypass
 * a failed proof re-resolves with, which has to reach the
 * origin past a CDN rather than only past the browser.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { splitVerificationMethod, resolveMultikey } from '../src/crypto/did-web';

afterEach(() => {
  vi.unstubAllGlobals();
});

// Any well-formed Ed25519 Multikey; these cases read the
// fetch, not the key.
const KEY = 'z6MkkXFYBvMjeXkh4xBubXGz3n8ByWLZmVu9me6zXqZJSZF4';

describe('splitVerificationMethod', () => {
  it('maps a did:web method to its well-known did.json', () => {
    const { url, fragment } = splitVerificationMethod('did:web:example.com#key-1');
    expect(url).toBe('https://example.com/.well-known/did.json');
    expect(fragment).toBe('key-1');
  });

  it('passes an absolute https URL through unchanged', () => {
    const { url } = splitVerificationMethod('https://example.com/keys/v1.pub#key-1');
    expect(url).toBe('https://example.com/keys/v1.pub#key-1');
  });

  it('passes a schemeless relative path through unchanged (the demo signer relies on this)', () => {
    const { url } = splitVerificationMethod('/keys/v1.pub#key-1');
    expect(url).toBe('/keys/v1.pub#key-1');
  });

  it('refuses an http: verificationMethod', () => {
    expect(() => splitVerificationMethod('http://example.com/keys/v1.pub')).toThrow(
      /refusing to resolve a http:/,
    );
  });

  it('refuses a data: verificationMethod', () => {
    expect(() => splitVerificationMethod('data:text/plain,x')).toThrow(
      /refusing to resolve a data:/,
    );
  });
});

describe('resolveMultikey', () => {
  it('attaches a real abort signal to the fetch call, wired to reject on abort', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }));

    const pending = resolveMultikey('https://example.com/keys/v1.pub');
    expect(capturedSignal).toBeInstanceOf(AbortSignal);

    // A hung key host would otherwise leave `pending` settled
    // never: prove aborting the exact signal resolveMultikey
    // handed to fetch is what unblocks it, not a coincidental
    // rejection from elsewhere.
    (capturedSignal as unknown as { dispatchEvent: (e: Event) => void })
      .dispatchEvent(new Event('abort'));
    await expect(pending).rejects.toThrow('aborted');
  });
  it('revalidates the browser cache on an ordinary resolution', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ publicKeyMultibase: KEY }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await resolveMultikey('https://example.com/keys/v1.pub');

    const [url, init] = fetchMock.mock.calls[0] as unknown as
      [string, RequestInit];
    expect(url).toBe('https://example.com/keys/v1.pub');
    expect(init.cache).toBe('no-cache');
  });

  it('reaches past a CDN when the bypass is asked for', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ publicKeyMultibase: KEY }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await resolveMultikey('https://example.com/keys/v1.pub', {
      bypassCache: true,
    });
    await resolveMultikey('https://example.com/keys/v1.pub', {
      bypassCache: true,
    });

    const first = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const second = fetchMock.mock.calls[1] as unknown as [string, RequestInit];

    // A request header is advisory to a CDN and most ignore
    // it, so the query is what actually reaches the origin,
    // and it differs per call so no cache can answer twice.
    expect(first[0]).toMatch(/\?tm-fresh=/);
    expect(first[1].cache).toBe('no-store');
    expect(second[0]).not.toBe(first[0]);
  });

  it('keeps a relative key path relative, fragment last', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ publicKeyMultibase: KEY }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    // The demo signer names its keys by path, which URL()
    // cannot parse without a base.
    await resolveMultikey('/keys/v1.pub#key-1', { bypassCache: true });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toMatch(/^\/keys\/v1\.pub\?tm-fresh=[^#]+#key-1$/);
  });
});
