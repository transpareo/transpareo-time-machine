/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * safeLinkHref guards anchors built from untrusted data
 * (library reference URLs, proof verificationMethod URLs)
 * against script-bearing schemes. These pin the allow-list.
 */

import { describe, it, expect } from 'vitest';
import { safeLinkHref } from '../src/safe-url';

describe('safeLinkHref', () => {
  it('allows http and https URLs', () => {
    expect(safeLinkHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeLinkHref('http://example.com')).toBe('http://example.com');
  });

  it('allows did: verification methods unchanged', () => {
    const did = 'did:web:issuer.test#key-1';
    expect(safeLinkHref(did)).toBe(did);
  });

  it('rejects javascript: URLs', () => {
    expect(safeLinkHref('javascript:alert(document.cookie)')).toBeNull();

    // Case and whitespace variants the browser would still
    // execute must also be rejected.
    expect(safeLinkHref('JavaScript:alert(1)')).toBeNull();
  });

  it('rejects data: and vbscript: URLs', () => {
    expect(safeLinkHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeLinkHref('vbscript:msgbox(1)')).toBeNull();
  });

  it('treats relative and protocol-relative URLs as safe', () => {
    // No scheme => can only resolve to the page http(s)
    // origin, so it is returned verbatim.
    expect(safeLinkHref('/local/path')).toBe('/local/path');
    expect(safeLinkHref('relative/path')).toBe('relative/path');
    expect(safeLinkHref('//cdn.example.com/x')).toBe('//cdn.example.com/x');
  });
});
