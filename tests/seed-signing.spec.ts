/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The demo authority keys are derived from a fixed seed, not
 * generated randomly, so the seed output is byte-identical
 * across builds. If that regresses, a redeploy rotates the
 * keys while clients still hold cached snapshots, and every
 * signature fails verification (the chain, internally
 * consistent, stays green) until the cache expires.
 *
 * These tests pin the guarantee: two independent signer runs
 * produce identical keys and signatures, and the renderer's
 * own verifier accepts a freshly signed snapshot as authentic
 * under both derived authorities.
 */

import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSnapshotSigner } from '../scripts/seed/signing.ts';
import { verifySnapshot } from '../src/crypto/verify';

const HANDLE = 'acme';
const CODE = 'demo-1';
const CREATED = '2026-01-02T03:04:05.000Z';

const SNAPSHOT = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  code: CODE,
  number: 1,
  name: 'Demo product',
};

const dirs: string[] = [];

async function freshSigner() {
  const dir = await mkdtemp(join(tmpdir(), 'tm-seed-'));
  dirs.push(dir);
  const signer = await buildSnapshotSigner(dir, HANDLE, CODE, CREATED);
  return { dir, signer };
}

function keyDoc(dir: string, file: string): Promise<string> {
  return readFile(join(dir, HANDLE, 'dpp', CODE, 'keys', file), 'utf8');
}

function manifest() {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    code: CODE,
    currentVersion: 1,
    versions: [{ number: 1, url: `/${HANDLE}/dpp/${CODE}/v/1.json` }],
  };
}

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('buildSnapshotSigner determinism', () => {
  it('derives identical keys across independent runs', async () => {
    const a = await freshSigner();
    const b = await freshSigner();
    expect(await keyDoc(a.dir, 'platform.json'))
      .toBe(await keyDoc(b.dir, 'platform.json'));
    expect(await keyDoc(a.dir, 'issuer.json'))
      .toBe(await keyDoc(b.dir, 'issuer.json'));
  });

  it('produces identical signatures across independent runs', async () => {
    const a = await freshSigner();
    const b = await freshSigner();
    expect(a.signer.signSnapshot({ ...SNAPSHOT }))
      .toEqual(b.signer.signSnapshot({ ...SNAPSHOT }));
    expect(a.signer.signManifest(manifest()))
      .toEqual(b.signer.signManifest(manifest()));
  });
});

describe('buildSnapshotSigner output verifies in the renderer', () => {
  let realFetch: typeof globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('verifies as authentic under two distinct authorities', async () => {
    const { dir, signer } = await freshSigner();
    const proof = signer.signSnapshot({ ...SNAPSHOT });

    // The verifier resolves each `verificationMethod` URL by
    // fetch; serve the signer's written key docs from the
    // signer's own output dir (fragment stripped).
    realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const rel = String(input).split('#')[0].replace(/^\//, '');
      const body = await readFile(join(dir, rel), 'utf8');
      return new Response(body, {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    const result = await verifySnapshot({ ...SNAPSHOT, proof });
    expect(result.verdict).toBe('authentic');
    expect(result.verifiedEntryCount).toBe(5);
    // Three issuer aliases + two platform aliases resolve to
    // exactly two distinct keys; the 2-of-2 verdict needs both.
    expect(result.verifiedAuthorityCount).toBe(2);
  });
});
