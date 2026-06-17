/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The wire->render adapter at the fetch boundary (host.ts).
 * Covers the access-tier split (public render vs the
 * post-auth legitimate-interest section) and the top-level
 * rating read, the two points where the wire contract and
 * the internal render model diverge.
 */

import { describe, expect, it } from 'vitest';
import { toRenderModel, adaptPrivateRows, type WireProperty } from '../src/host';
import type { SignedSnapshot } from '../src/archive';

function row(propertyID: string, access?: string): WireProperty {
  return {
    propertyID,
    name: { en: propertyID },
    value: 'v',
    ...(access ? { access: access as WireProperty['access'] } : {}),
  };
}

function wire(
  properties: ReadonlyArray<WireProperty>,
  extra: Record<string, unknown> = {},
): SignedSnapshot {
  return {
    version: 1,
    publishedAt: '2026-01-01T00:00:00Z',
    passportAlias: 'a1b2-c3d4-e5f6',
    dppStatus: 'inUse',
    rating: 'good',
    issuer: { '@type': 'Organization', name: 'Issuer', did: 'did:web:i' },
    platform: { '@type': 'Organization', name: 'Platform', did: 'did:web:p' },
    product: { '@type': 'Product', name: { en: 'X' }, brand: 'B', properties },
    proof: [],
    ...extra,
  } as unknown as SignedSnapshot;
}

describe('toRenderModel: access split', () => {
  it('keeps public + onDemand, drops legitimateInterest + authorities', () => {
    const model = toRenderModel(wire([
      row('a:public'),
      row('a:onDemand', 'onDemand'),
      row('a:li', 'legitimateInterest'),
      row('a:auth', 'authorities'),
    ]));
    expect(model.properties.map((p) => p.key)).toEqual([
      'a:public', 'a:onDemand',
    ]);
  });

  it('gates an onDemand row by its propertyID namespace', () => {
    const model = toRenderModel(wire([row('a:onDemand', 'onDemand')]));
    const r = model.properties[0];
    expect(r.namespace).toBe('a:onDemand');
    expect(r.onDemand).toBe(true);
  });
});

describe('toRenderModel: changedProperties', () => {
  it('normalizes the ChangeSet to always-present arrays', () => {
    const model = toRenderModel(wire([], {
      priorVersion: 1,
      changedProperties: {
        '@type': 'dpp:ChangeSet',
        added: ['transpareo:co2'],
        modified: ['transpareo:weight'],
      },
    }));
    expect(model.priorVersion).toBe(1);
    expect(model.changedProperties).toEqual({
      added: ['transpareo:co2'], removed: [], modified: ['transpareo:weight'],
    });
  });

  it('drops the block when every array is empty or absent', () => {
    expect(toRenderModel(wire([])).changedProperties).toBeUndefined();
    const empty = toRenderModel(
      wire([], { changedProperties: { '@type': 'dpp:ChangeSet' } }),
    );
    expect(empty.changedProperties).toBeUndefined();
  });

  it('keeps only string ids', () => {
    const model = toRenderModel(wire([], {
      changedProperties: { added: ['ok', 42, null] },
    }));
    expect(model.changedProperties).toEqual({
      added: ['ok'], removed: [], modified: [],
    });
  });
});

describe('toRenderModel: identifiers', () => {
  it('maps identifiers.gtin onto the product', () => {
    const model = toRenderModel(wire([], {
      identifiers: { code: 'demo-1', gtin: '4012345678901' },
    }));
    expect(model.product.gtin).toBe('4012345678901');
  });

  it('accepts a top-level gtin as a fallback', () => {
    const model = toRenderModel(wire([], { gtin: '4012345678901' }));
    expect(model.product.gtin).toBe('4012345678901');
  });

  it('leaves gtin unset when the wire carries none', () => {
    expect(toRenderModel(wire([])).product.gtin).toBeUndefined();
  });
});

describe('toRenderModel: rating location', () => {
  it('reads the top-level rating onto the product', () => {
    expect(toRenderModel(wire([])).product.rating).toBe('good');
  });

  it('falls back to product.rating when no top-level rating', () => {
    const raw = wire([], { rating: undefined }) as unknown as
      { product: { rating?: string } };
    raw.product.rating = 'bad';
    expect(toRenderModel(raw as unknown as SignedSnapshot).product.rating)
      .toBe('bad');
  });
});

describe('adaptPrivateRows: post-auth tiers', () => {
  it('keeps only legitimateInterest rows', () => {
    const out = adaptPrivateRows([
      row('a:public'),
      row('a:onDemand', 'onDemand'),
      row('a:li', 'legitimateInterest'),
      row('a:auth', 'authorities'),
    ]);
    expect(out.map((r) => r.key)).toEqual(['a:li']);
  });

  it('namespaces surfaced rows so they reach the detail table', () => {
    const out = adaptPrivateRows([row('a:li', 'legitimateInterest')]);
    expect(out[0].namespace).toBe('a:li');
  });
});
