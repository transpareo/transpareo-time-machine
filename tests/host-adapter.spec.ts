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

describe('toRenderModel: product weight', () => {
  // The wire weight is a QuantitativeValue whose own `value`
  // is now a typed literal ({'@value', '@type'}), not a bare
  // JSON number, so its RDF datatype is explicit.
  it('reads a QuantitativeValue weight from a typed literal value', () => {
    const model = toRenderModel(wire([], {
      product: {
        '@type': 'Product', name: { en: 'X' }, brand: 'B', properties: [],
        weight: {
          '@type': 'QuantitativeValue',
          value: { '@value': '250.0', '@type': 'xsd:decimal' },
          unitCode: 'KGM',
        },
      },
    }));
    expect(model.product.weight).toBe(250);
    expect(model.product.weightUnit).toBe('kg');
  });
});

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

describe('toRenderModel: image references', () => {
  const SNAPSHOT = 'https://cdn.example.com/dpp/p1/v/3-abc.jsonld.gz';

  function withImages(images: unknown): SignedSnapshot {
    return wire([], {
      product: {
        '@type': 'Product', name: { en: 'X' }, brand: 'B',
        properties: [], images
      }
    });
  }

  it('resolves a root-relative reference onto the snapshot host', () => {
    const model = toRenderModel(withImages([
      { thumbnail: '/media/a-800.jpg', large: '/media/a-1500.jpg' }
    ]), SNAPSHOT);
    expect(model.product.images[0].thumbnail).
      toBe('https://cdn.example.com/media/a-800.jpg');
    expect(model.product.images[0].large).
      toBe('https://cdn.example.com/media/a-1500.jpg');
  });

  it('resolves a path-relative reference beside the snapshot', () => {
    const model = toRenderModel(withImages(['a-800.jpg']), SNAPSHOT);
    expect(model.product.images[0].thumbnail).
      toBe('https://cdn.example.com/dpp/p1/v/a-800.jpg');
  });

  it('leaves an absolute reference untouched', () => {
    const abs = 'https://other.example.com/a.jpg';
    const model = toRenderModel(
      withImages([{ thumbnail: abs, large: abs }]), SNAPSHOT
    );
    expect(model.product.images[0].thumbnail).toBe(abs);
  });

  it('coerces a flat-string entry to both sizes', () => {
    const model = toRenderModel(withImages(['/media/a.jpg']), SNAPSHOT);
    expect(model.product.images[0]).toEqual({
      thumbnail: 'https://cdn.example.com/media/a.jpg',
      large: 'https://cdn.example.com/media/a.jpg'
    });
  });

  it('leaves references as they stand with no base', () => {
    const model = toRenderModel(withImages(['/media/a.jpg']));
    expect(model.product.images[0].thumbnail).toBe('/media/a.jpg');
  });

  it('yields no images when the wire carries none', () => {
    expect(toRenderModel(wire([]), SNAPSHOT).product.images).toEqual([]);
  });

  it('resolves every rendition and orders them narrowest first', () => {
    const model = toRenderModel(withImages([{
      thumbnail: '/media/a-800.jpg', large: '/media/a-1500.jpg',
      variants: [
        { url: '/media/a-800.jpg', width: 800 },
        { url: '/media/a-400.jpg', width: 400 }
      ]
    }]), SNAPSHOT);
    expect(model.product.images[0].variants).toEqual([
      { url: 'https://cdn.example.com/media/a-400.jpg', width: 400 },
      { url: 'https://cdn.example.com/media/a-800.jpg', width: 800 }
    ]);
  });

  it('drops a rendition with no usable width', () => {
    const model = toRenderModel(withImages([{
      thumbnail: '/a.jpg', large: '/a.jpg',
      variants: [
        { url: '/a-400.jpg', width: 400 },
        { url: '/a-800.jpg', width: 0 },
        { url: '/a-1500.jpg' },
        { url: '', width: 600 },
        { url: '/a-1200.jpg', width: 1200 }
      ]
    }]), SNAPSHOT);
    const widths = model.product.images[0].variants?.map((v) => v.width);
    expect(widths).toEqual([400, 1200]);
  });

  it('leaves a lone rendition off: src already says it', () => {
    const model = toRenderModel(withImages([{
      thumbnail: '/a.jpg', large: '/a.jpg',
      variants: [{ url: '/a-800.jpg', width: 800 }]
    }]), SNAPSHOT);
    expect(model.product.images[0].variants).toBeUndefined();
  });

  it('names no renditions for a snapshot that carries none', () => {
    const model = toRenderModel(withImages(['/media/a.jpg']), SNAPSHOT);
    expect(model.product.images[0].variants).toBeUndefined();
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

describe('toRenderModel: battery units', () => {
  // A battery passport's rows carry UN/CEFACT codes; the
  // reader sees the symbol the code stands for.
  it.each([
    ['AMH', 'Ah'], ['KWH', 'kWh'], ['WHR', 'Wh'], ['VLT', 'V'],
    ['WTT', 'W'], ['OHM', 'Ω'], ['CEL', '°C'],
  ])('shows %s as %s', (unitCode, symbol) => {
    const property = { propertyID: 'p', name: { en: 'p' }, value: 1, unitCode }
    const model = toRenderModel(wire([property]));
    expect(model.properties[0].value).toMatchObject({ unit: symbol });
  });
});

describe('toRenderModel: dynamic rows', () => {
  // A row marked dynamic carries the reading taken at
  // publish; the live value is in the dynamic-data document.
  it('keeps the marked row and flags it', () => {
    const reading = { ...row('bpass:stateOfCharge'), value: 81, dynamic: true }
    const model = toRenderModel(wire([row('model'), reading]));

    expect(model.properties.map((p) => [p.key, p.dynamic])).toEqual([
      ['model', undefined], ['bpass:stateOfCharge', true],
    ]);
  });

  // Only a JSON true marks a row.
  it('reads anything but true as a static row', () => {
    const odd = { ...row('x'), dynamic: 'true' } as unknown as WireProperty
    const model = toRenderModel(wire([odd]));

    expect(model.properties[0].dynamic).toBeUndefined();
  });
});
