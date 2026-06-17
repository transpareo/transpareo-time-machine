/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * readJsonResponse parses JSON whether the body arrives
 * already-decompressed (Content-Encoding handled by the
 * platform) or as raw gzip with no header (older CDN
 * objects), so a header-less gzipped snapshot still loads.
 */

import { describe, it, expect } from 'vitest';
import { readJsonResponse } from '../src/fetch-json';

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Response(text).body!
    .pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

describe('readJsonResponse', () => {
  it('parses a plain JSON body', async () => {
    const res = new Response(JSON.stringify({ a: 1, nested: { b: 2 } }));
    expect(await readJsonResponse(res)).toEqual({ a: 1, nested: { b: 2 } });
  });

  it('gunzips a raw-gzip body served without a header', async () => {
    const payload = { version: 3, proof: [{ proofValue: 'z1' }] };
    const res = new Response(await gzip(JSON.stringify(payload)));
    expect(await readJsonResponse(res)).toEqual(payload);
  });

  it('rejects a gzip bomb instead of inflating it', async () => {
    // 11 MB of one repeated character compresses to a few
    // KB but inflates past the 10 MB cap, so the reader
    // must abort rather than buffer it all.
    const bomb = JSON.stringify({ pad: 'x'.repeat(11 * 1024 * 1024) });
    const res = new Response(await gzip(bomb));
    await expect(readJsonResponse(res)).rejects.toThrow(/inflates past/);
  });
});
