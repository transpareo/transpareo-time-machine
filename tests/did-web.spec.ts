/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Coverage for src/crypto/did-web.ts: the verificationMethod
 * splitter's fail-closed scheme rules, and resolveMultikey's
 * fetch behaviour (a timeout signal is attached; aborting it
 * rejects rather than hanging forever).
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { splitVerificationMethod, resolveMultikey } from '../src/crypto/did-web';

afterEach(() => {
  vi.unstubAllGlobals();
});

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
});
