/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The seeded events feed names its passport under
 * `transpareo:code`, beside `epcisBody` and inside the body
 * its signature covers, as the publisher writes it. The SPA
 * shows a feed's events only when the feed names the
 * passport its manifest is for, so the feed of every
 * manifest fixture passes that check for its own code,
 * fails it for another, and fails its signature once
 * relabelled for another passport.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import {
  afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi
} from 'vitest'
import { FixtureSchema, type Fixture } from '../scripts/seed/schema.ts'
import { buildEpcis } from '../scripts/seed/emit-artefacts.ts'
import { buildSnapshotSigner } from '../scripts/seed/signing.ts'
import * as host from '../src/host'
import { events, eventsProofState, resetBootState } from '../src/state'
import { ensureEventsVerified, resetVerifyCaches } from '../src/actions'
import { forgetKeyDocuments } from '../src/crypto/did-web'
import type { DppManifest } from '../src/archive'
import type { EpcisDocument } from '../src/epcis'

const FIXTURES = new URL('../fixtures/', import.meta.url)
const OTHER = 'demo-2026-x999'

// Every fixture the seed publishes a manifest and a feed for.
const fixtures = readdirSync(FIXTURES)
  .filter((file) => file.endsWith('.yml'))
  .map((file) => readFileSync(new URL(file, FIXTURES), 'utf8'))
  .map((yaml) => FixtureSchema.parse(parse(yaml)))
  .filter((fixture) => fixture.publication === 'manifest')

let keysDir: string

// The feed as the seed emits it, signed by the signer the
// seed builds for the fixture. Its key documents land in
// keysDir, where the fetch stub serves them from.
async function seededFeed(fixture: Fixture): Promise<EpcisDocument> {
  const { id, code, published_at: publishedAt } = fixture
  const signer = await buildSnapshotSigner(keysDir, id, code, publishedAt)
  return buildEpcis(fixture, signer) as unknown as EpcisDocument
}

// Land the feed beside a manifest for the code given, run the
// SPA's check on it and settle the verdict.
async function judge(doc: EpcisDocument, code: string): Promise<unknown> {
  host.manifest.set({ code } as DppManifest)
  host.epcisDocument.set(doc)
  host.eventsPending.set(false)
  ensureEventsVerified()
  await vi.waitFor(() => {
    expect(eventsProofState.peek()).not.toBe('pending')
  })
  return eventsProofState.peek()
}

async function serveKeys(input: RequestInfo | URL): Promise<Response> {
  const path = new URL(String(input), 'http://seed.test').pathname
  const body = await readFile(join(keysDir, path), 'utf8')
  const headers = { 'content-type': 'application/json' }
  return new Response(body, { status: 200, headers })
}

beforeAll(async () => {
  keysDir = await mkdtemp(join(tmpdir(), 'tm-seed-epcis-'))
})

afterAll(async () => {
  await rm(keysDir, { recursive: true, force: true })
})

beforeEach(() => {
  vi.stubGlobal('fetch', serveKeys)
})

afterEach(() => {
  resetVerifyCaches()
  resetBootState()
  forgetKeyDocuments()
  host.manifest.set(null)
  host.epcisDocument.set(null)
  vi.unstubAllGlobals()
})

it('reads the manifest fixtures', () => {
  expect(fixtures).not.toHaveLength(0)
})

describe.each(fixtures)('the seeded feed of $id', (fixture) => {
  it('names its passport beside epcisBody', async () => {
    const feed = await seededFeed(fixture)
    expect(feed['transpareo:code']).toBe(fixture.code)
    expect(Object.keys(feed)).toEqual([
      '@context', 'type', 'schemaVersion', 'creationDate',
      'transpareo:code', 'epcisBody', 'transpareo:signature'
    ])
  })

  it('passes the SPA check for its own passport', async () => {
    const feed = await seededFeed(fixture)
    expect(await judge(feed, fixture.code))
      .toMatchObject({ status: 'verified' })
    expect(events()).not.toEqual([])
  })

  it('fails the SPA check for another passport', async () => {
    const feed = await seededFeed(fixture)
    expect(await judge(feed, OTHER)).toMatchObject({
      status: 'invalid',
      reason: `events feed names passport ${fixture.code}, not ${OTHER}`
    })
    expect(events()).toEqual([])
  })

  // Replayed under another passport's manifest, the feed
  // relabelled for it clears the name and fails the
  // signature, which covers the code.
  it('fails its signature once relabelled', async () => {
    const feed = await seededFeed(fixture)
    const relabelled = { ...feed, 'transpareo:code': OTHER }
    expect(await judge(relabelled, OTHER)).toMatchObject({
      status: 'invalid',
      reason: expect.stringContaining('signature')
    })
    expect(events()).toEqual([])
  })
})
