/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The revocation gate in a real browser. A page that pins a
 * platform key must read the revocation list once at boot,
 * through either delivery: the lib entry (the dev page) and
 * the single-file embed, which is what a live passport page
 * loads. The unit tests set the pins on the config by hand,
 * so only a booted element shows whether the check ran.
 */
import { test, expect } from '@playwright/test'

type Page = import('@playwright/test').Page

// Any well-formed Ed25519 Multikey: the check fingerprints
// it, and nothing here needs it to verify a proof.
const PIN = 'z6MkkXFYBvMjeXkh4xBubXGz3n8ByWLZmVu9me6zXqZJSZF4'

const LIST = '**/.well-known/dpp-revoked-roots.json'
const EMBED_URL = 'http://localhost:5175/'

// Pin the page's element and record every read of the list.
async function pinned(page: Page, url: string): Promise<string[]> {
  const requests: string[] = []
  await page.route(LIST, async (route) => {
    requests.push(route.request().url())
    await route.fulfill({ json: { revokedRoots: [] } })
  })
  await page.route(url, async (route) => {
    const res = await route.fetch()
    // Every opening tag, comments included: the dev page
    // names the element in a comment above the real one.
    const body = (await res.text()).replaceAll(
      /<transpareo-time-machine(?=[\s>])/g,
      `<transpareo-time-machine pinned-platform-key="${PIN}"`,
    )
    await route.fulfill({ response: res, body })
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  return requests
}

// A rewritten read can still be in flight when a test ends,
// and the closing context drops the body it fetched. Every
// route here is hit while the test runs, so a broken handler
// fails it there; only reads still in flight at the end are
// let go.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

for (const [entry, url] of [['lib', '/'], ['embed', EMBED_URL]]) {
  test(`a pinned page reads the revocation list once (${entry})`, async ({
    page,
  }) => {
    const requests = await pinned(page, url)

    await expect.poll(() => requests.length).toBe(1)
    expect(requests[0])
      .toBe('https://transpareo.com/.well-known/dpp-revoked-roots.json')
  })
}
