/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Attribute parsing for the host config, focused on the
 * pinned-key attributes: both carry a whitespace-separated
 * multikey set (several keys because rotation keeps
 * retired-but-sound keys verifiable).
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';

type ConfigModule = typeof import('../src/config');

// The config module keeps its parsed state at module
// level; re-import per test so one test's attributes
// don't leak into the next.
async function freshConfig(): Promise<ConfigModule> {
  vi.resetModules();
  return import('../src/config');
}

// initConfigFromElement only touches getAttribute /
// hasAttribute, so a plain attribute map stands in for
// the custom element (vitest runs without a DOM).
function fakeElement(attrs: Record<string, string>): Element {
  return {
    getAttribute: (name: string) => attrs[name] ?? null,
    hasAttribute: (name: string) => name in attrs,
  } as unknown as Element;
}

let mod: ConfigModule;
beforeEach(async () => {
  mod = await freshConfig();
});

describe('pinned-platform-key parsing', () => {
  it('parses a single multikey into a one-element set', () => {
    mod.initConfigFromElement(fakeElement({
      'pinned-platform-key': 'z6MkCurrentRoot',
    }));
    expect(mod.config.pinnedPlatformKeys).toEqual(['z6MkCurrentRoot']);
  });

  it('splits several whitespace-separated multikeys', () => {
    mod.initConfigFromElement(fakeElement({
      'pinned-platform-key': 'z6MkCurrentRoot  z6MkRetiredRoot\nz6MkOlderRoot',
    }));
    expect(mod.config.pinnedPlatformKeys)
      .toEqual(['z6MkCurrentRoot', 'z6MkRetiredRoot', 'z6MkOlderRoot']);
  });

  it('is undefined when the attribute is absent', () => {
    mod.initConfigFromElement(fakeElement({}));
    expect(mod.config.pinnedPlatformKeys).toBeUndefined();
  });

  it('is undefined when the attribute is blank', () => {
    mod.initConfigFromElement(fakeElement({
      'pinned-platform-key': '   ',
    }));
    expect(mod.config.pinnedPlatformKeys).toBeUndefined();
  });
});

describe('pinned-issuer-key parsing', () => {
  it('parses the issuer key set the same way', () => {
    mod.initConfigFromElement(fakeElement({
      'pinned-issuer-key': 'z6MkByokKey z6MkRetiredIssuerKey',
    }));
    expect(mod.config.pinnedIssuerKeys)
      .toEqual(['z6MkByokKey', 'z6MkRetiredIssuerKey']);
  });

  it('is undefined when the attribute is absent', () => {
    mod.initConfigFromElement(fakeElement({}));
    expect(mod.config.pinnedIssuerKeys).toBeUndefined();
  });
});

describe('icon-map-src parsing', () => {
  it('reads the map URL off the attribute', () => {
    mod.initConfigFromElement(fakeElement({
      'icon-map-src': '/acme/icon-map.json',
    }));
    expect(mod.config.iconMapUrl).toBe('/acme/icon-map.json');
  });

  it('is undefined when the attribute is absent', () => {
    mod.initConfigFromElement(fakeElement({}));
    expect(mod.config.iconMapUrl).toBeUndefined();
  });
});
