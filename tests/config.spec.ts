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

describe('logo-href parsing', () => {
  it('carries the attribute through verbatim', () => {
    mod.initConfigFromElement(fakeElement({
      'logo-href': 'https://nordic-wear.example/',
    }));
    expect(mod.config.logoHref).toBe('https://nordic-wear.example/');
  });

  it('is undefined when the attribute is absent', () => {
    mod.initConfigFromElement(fakeElement({}));
    expect(mod.config.logoHref).toBeUndefined();
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

describe('sign-in-url parsing', () => {
  it('reads the sign-in address off the attribute', () => {
    mod.initConfigFromElement(fakeElement({
      'sign-in-url': 'https://acme.com/passport/login',
    }));
    expect(mod.config.signInUrl).toBe('https://acme.com/passport/login');
  });

  it('is undefined when the attribute is absent', () => {
    mod.initConfigFromElement(fakeElement({}));
    expect(mod.config.signInUrl).toBeUndefined();
  });
});

// Set by the HTML shell when it answers a unit link with the
// passport one level up.
describe('requested-level / requested-id parsing', () => {
  it('carries both attributes through', () => {
    mod.initConfigFromElement(fakeElement({
      'requested-level': 'item', 'requested-id': 'SN-1',
    }));
    expect(mod.config.requested).toEqual({ level: 'item', id: 'SN-1' });
  });

  it('is undefined when neither is set', () => {
    mod.initConfigFromElement(fakeElement({}));
    expect(mod.config.requested).toBeUndefined();
  });
});

// The origin root paths resolve against. Kept as written:
// "/" means the page's own origin, which only the page can
// say, so resolving it is the host layer's work.
describe('asset-host parsing', () => {
  it('carries an origin through verbatim', () => {
    mod.initConfigFromElement(fakeElement({
      'asset-host': 'https://cdn.example',
    }));
    expect(mod.config.assetHost).toBe('https://cdn.example');
  });

  it('carries "/" through for the page origin', () => {
    mod.initConfigFromElement(fakeElement({ 'asset-host': '/' }));
    expect(mod.config.assetHost).toBe('/');
  });

  it('is undefined when the attribute is absent', () => {
    mod.initConfigFromElement(fakeElement({}));
    expect(mod.config.assetHost).toBeUndefined();
  });

  it.each(['', '   '])('is undefined for %j', (value) => {
    mod.initConfigFromElement(fakeElement({ 'asset-host': value }));
    expect(mod.config.assetHost).toBeUndefined();
  });
});

// Set by the shell of a static archive: the day the copy
// was made. A calendar date only, since the band prints a
// day, and anything else leaves the archive line off.
describe('archived-at parsing', () => {
  it('reads a calendar date', () => {
    mod.initConfigFromElement(fakeElement({ 'archived-at': '2026-10-08' }));
    expect(mod.config.archivedAt).toBe('2026-10-08');
  });

  it('is undefined when the attribute is absent', () => {
    mod.initConfigFromElement(fakeElement({}));
    expect(mod.config.archivedAt).toBeUndefined();
  });

  it.each(['', 'yesterday', '2026-10-08T12:00:00Z', '2026-02-30'])(
    'ignores %j',
    (value) => {
      mod.initConfigFromElement(fakeElement({ 'archived-at': value }));
      expect(mod.config.archivedAt).toBeUndefined();
    },
  );
});
