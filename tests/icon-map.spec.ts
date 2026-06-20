/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The external property icon map: a publisher serves a
 * key->symbol table beside the sprite (icon-map-src), and
 * the SPA joins each row's `key` onto it. Snapshots carry
 * no icon, so a row the map omits renders iconless.
 * loadContentIconMap is best-effort: a failed or malformed
 * fetch leaves the map empty rather than throwing, and only
 * bare `#id`-shaped string values survive sanitizing.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';

type IconsModule = typeof import('../src/icons');
type ConfigModule = typeof import('../src/config');

function fakeElement(attrs: Record<string, string>): Element {
  return {
    getAttribute: (name: string) => attrs[name] ?? null,
    hasAttribute: (name: string) => name in attrs,
  } as unknown as Element;
}

// Re-import per test so a loaded map doesn't leak; point the
// config at a URL so iconMapUrl() resolves to it.
async function load(src = '/p/icon-map.json'): Promise<IconsModule> {
  vi.resetModules();
  const cfg: ConfigModule = await import('../src/config');
  cfg.initConfigFromElement(fakeElement({ 'icon-map-src': src }));
  return import('../src/icons');
}

function mockFetch(body: unknown, ok = true): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(body),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('iconForProperty', () => {
  it('returns null before the map has loaded', async () => {
    const icons = await load();
    expect(icons.iconForProperty('material')).toBeNull();
  });

  it('joins a row key onto the loaded map', async () => {
    mockFetch({ material: 'sliders', carbon: 'leaf' });
    const icons = await load();
    icons.loadContentIconMap();
    await vi.waitFor(() =>
      expect(icons.iconForProperty('material')).toBe('sliders'));
    expect(icons.iconForProperty('carbon')).toBe('leaf');
  });

  it('returns null for a key the map omits', async () => {
    mockFetch({ material: 'sliders' });
    const icons = await load();
    icons.loadContentIconMap();
    await vi.waitFor(() =>
      expect(icons.iconForProperty('material')).toBe('sliders'));
    expect(icons.iconForProperty('accessories')).toBeNull();
  });

  it('drops non-string and non-id values', async () => {
    mockFetch({ ok: 'leaf', bad: 42, evil: '#x" onload="', spaced: 'a b' });
    const icons = await load();
    icons.loadContentIconMap();
    await vi.waitFor(() =>
      expect(icons.iconForProperty('ok')).toBe('leaf'));
    expect(icons.iconForProperty('bad')).toBeNull();
    expect(icons.iconForProperty('evil')).toBeNull();
    expect(icons.iconForProperty('spaced')).toBeNull();
  });

  it('leaves the map empty when the fetch fails', async () => {
    mockFetch({}, false);
    const icons = await load();
    icons.loadContentIconMap();
    await Promise.resolve();
    await Promise.resolve();
    expect(icons.iconForProperty('material')).toBeNull();
  });
});
