// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableCSSFileLoading": true, "disableJavaScriptFileLoading": true, "disableJavaScriptEvaluation": true } }
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Passport-page-to-manifest resolution behind the verifier
 * widget's input: the body sniff that separates a JSON
 * artefact from a passport page, and the lookup of the
 * page's manifest reference (embedded renderer src, then
 * <link rel="alternate"> with a JSON type).
 */

import { describe, it, expect } from 'vitest';
import {
  looksLikeHtml, discoverManifestUrl,
} from '../src/manifest-discovery';

const PAGE_URL = 'https://shop.example.com/products/tee-1/passport';

function page(headExtra: string, bodyExtra = ''): string {
  return `<!doctype html>
    <html>
      <head><title>Passport</title>${headExtra}</head>
      <body><h1>Organic Tee</h1>${bodyExtra}</body>
    </html>`;
}

describe('looksLikeHtml', () => {
  it('flags a document starting with markup', () => {
    expect(looksLikeHtml('<!doctype html><html></html>')).toBe(true);
    expect(looksLikeHtml('<html lang="en">')).toBe(true);
  });

  it('tolerates leading whitespace and a BOM', () => {
    expect(looksLikeHtml('\n\t <!doctype html>')).toBe(true);
    expect(looksLikeHtml('﻿<html>')).toBe(true);
  });

  it('passes JSON bodies through as non-HTML', () => {
    expect(looksLikeHtml('{"@type":"DppManifest"}')).toBe(false);
    expect(looksLikeHtml('  {"versions":[]}')).toBe(false);
    expect(looksLikeHtml('')).toBe(false);
  });
});

describe('discoverManifestUrl', () => {
  it('reads the embedded renderer src', () => {
    const html = page('', `
      <transpareo-time-machine
        src="https://cdn.example.com/acme/dpp/abc-123/manifest.json">
      </transpareo-time-machine>`);
    expect(discoverManifestUrl(html, PAGE_URL)).
      toBe('https://cdn.example.com/acme/dpp/abc-123/manifest.json');
  });

  it('resolves a relative renderer src against the page URL', () => {
    const html = page('', `
      <transpareo-time-machine src="manifest.json">
      </transpareo-time-machine>`);
    expect(discoverManifestUrl(html, PAGE_URL)).
      toBe('https://shop.example.com/products/tee-1/manifest.json');
  });

  it('resolves a root-relative renderer src against the page origin', () => {
    const html = page('', `
      <transpareo-time-machine src="/acme/dpp/abc-123/manifest.json">
      </transpareo-time-machine>`);
    expect(discoverManifestUrl(html, PAGE_URL)).
      toBe('https://shop.example.com/acme/dpp/abc-123/manifest.json');
  });

  it('falls back to a link rel=alternate with a JSON type', () => {
    const html = page(`
      <link rel="alternate" type="application/json"
        href="/dpp/abc-123/manifest.json">`);
    expect(discoverManifestUrl(html, PAGE_URL)).
      toBe('https://shop.example.com/dpp/abc-123/manifest.json');
  });

  it('accepts application/ld+json and multi-token rel lists', () => {
    const html = page(`
      <link rel="ALTERNATE nofollow" type="application/LD+JSON"
        href="manifest.json">`);
    expect(discoverManifestUrl(html, PAGE_URL)).
      toBe('https://shop.example.com/products/tee-1/manifest.json');
  });

  it('prefers the embedded renderer over a link alternate', () => {
    const html = page(
      `<link rel="alternate" type="application/json" href="/other.json">`,
      `<transpareo-time-machine src="/renderer.json">
      </transpareo-time-machine>`,
    );
    expect(discoverManifestUrl(html, PAGE_URL)).
      toBe('https://shop.example.com/renderer.json');
  });

  it('ignores alternates of unrelated types and non-alternate rels', () => {
    const html = page(`
      <link rel="alternate" type="application/json+oembed" href="/oembed">
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
      <link rel="manifest" type="application/json" href="/app.webmanifest">`);
    expect(discoverManifestUrl(html, PAGE_URL)).toBeNull();
  });

  it('skips an empty renderer src and uses the link instead', () => {
    const html = page(
      `<link rel="alternate" type="application/json" href="/m.json">`,
      `<transpareo-time-machine src=""></transpareo-time-machine>`,
    );
    expect(discoverManifestUrl(html, PAGE_URL)).
      toBe('https://shop.example.com/m.json');
  });

  it('returns null when the page declares no manifest', () => {
    expect(discoverManifestUrl(page(''), PAGE_URL)).toBeNull();
  });

  it('refuses non-http(s) references', () => {
    const html = page('', `
      <transpareo-time-machine src="javascript:alert(1)">
      </transpareo-time-machine>`);
    expect(discoverManifestUrl(html, PAGE_URL)).toBeNull();
  });
});
