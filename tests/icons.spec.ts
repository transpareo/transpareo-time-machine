/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Two-tier icon contract (see src/icons.ts):
 *
 * - Functional icons ship inline as a bundled sprite
 *   injected on boot and flagged `icon--fn`; they render
 *   with or without an external content sprite.
 * - Decorative icons come from the content sprite at
 *   config.iconsUrl (the dev shell supplies /icons.svg);
 *   the host gains `data-icons` only when one is
 *   configured, and the stylesheet collapses decorative
 *   icons (no empty box) when it is absent.
 *
 * Runs against `npm run dev`, which renders the full
 * fixture DPP so both tiers are on the page.
 *
 * The content sprite is untrusted markup from a
 * publisher-configured URL, so the last two tests pin the
 * sanitizer contract: only scrubbed <symbol> nodes may land
 * in the shadow root, and a non-SVG content-type injects
 * nothing.
 */
import { test, expect } from '@playwright/test'

test('functional icons render inline; decorative icons gate on a content sprite', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' })

  // Wait for the SPA tree to mount (a functional icon is
  // present once the chrome has rendered).
  await page.waitForFunction(() => {
    const host = document.querySelector('transpareo-time-machine')
    return host?.shadowRoot?.querySelector('svg.icon--fn') != null
  })

  const r = await page.evaluate(() => {
    const host = document.querySelector('transpareo-time-machine')!
    const root = host.shadowRoot!
    const fn = root.querySelector('svg.icon--fn')
    const content = root.querySelector('svg.icon:not(.icon--fn)')
    const disp = (el: Element | null): string | null =>
      el ? getComputedStyle(el).display : null

    const out = {
      // The functional sprite is bundled and injected, so its
      // symbols exist even with no content sprite fetched.
      functionalSymbol: root.querySelector('symbol#icon-cancel') != null,
      foundFn: fn != null,
      foundContent: content != null,
      dataIcons: host.hasAttribute('data-icons'),
      withSprite: { fn: disp(fn), content: disp(content) },
      noSprite: { fn: null as string | null, content: null as string | null },
    }

    // Simulate a no-sprite host (an OSS fork ships none).
    host.removeAttribute('data-icons')
    out.noSprite = { fn: disp(fn), content: disp(content) }
    return out
  })

  expect(r.functionalSymbol).toBe(true)
  expect(r.foundFn).toBe(true)
  expect(r.foundContent).toBe(true)

  // The dev shell supplies a content sprite.
  expect(r.dataIcons).toBe(true)

  // With a sprite, both tiers render.
  expect(r.withSprite.fn).not.toBe('none')
  expect(r.withSprite.content).not.toBe('none')

  // Without one, functional icons stay; decorative collapse.
  expect(r.noSprite.fn).not.toBe('none')
  expect(r.noSprite.content).toBe('none')
})

// Every vector a compromised sprite host could ship:
// script/style elements, event-handler attributes, SMIL
// href retargeting, smuggled HTML (iframe), foreignObject,
// and non-fragment hrefs (javascript: links, remote image
// loads). The benign payload (paths, fragment <use> refs)
// must survive the scrub.
const HOSTILE_SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <script>window.__pwned = 'sprite-script'</script>
  <style>:host { display: none !important }</style>
  <symbol id="icon-evil" viewBox="0 0 10 10" onload="window.__pwned='onload'">
    <path d="M0 0h10v10z" onclick="window.__pwned='onclick'"/>
    <image href="https://evil.example/x.png" onerror="window.__pwned='onerror'"/>
    <foreignObject>
      <iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:window.__pwned='iframe'"></iframe>
    </foreignObject>
    <iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:window.__pwned='bare-iframe'"></iframe>
    <a href="javascript:window.__pwned='link'"><rect width="10" height="10"/></a>
    <a xlink:href="javascript:window.__pwned='xlink'"><circle r="4"/></a>
    <set attributeName="href" to="javascript:window.__pwned='smil'"/>
    <use href="#icon-evil-extra"/>
  </symbol>
  <symbol id="icon-evil-extra" viewBox="0 0 4 4"><rect width="2" height="2"/></symbol>
</svg>`

test('a hostile content sprite is scrubbed to bare symbols', async ({
  page,
}) => {
  await page.route('**/icons.svg', (route) => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: HOSTILE_SPRITE,
  }))
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => {
    const host = document.querySelector('transpareo-time-machine')
    return host?.shadowRoot?.querySelector('symbol#icon-evil') != null
  })

  const r = await page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const sprite = root.querySelector('symbol#icon-evil')!.closest('svg')!
    const XLINK = 'http://www.w3.org/1999/xlink'
    const handlerCount = [...sprite.querySelectorAll('*')]
      .filter((node) => [...node.attributes].some((a) => /^on/i.test(a.name)))
      .length
    return {
      pwned: (window as { __pwned?: string }).__pwned ?? null,
      forbidden: sprite.querySelectorAll(
        'script, style, foreignObject, iframe, set',
      ).length,
      handlerCount,
      symbolCount: sprite.querySelectorAll('symbol').length,
      pathSurvives: sprite.querySelector('#icon-evil path') != null,
      fragmentUse: sprite.querySelector('use')?.getAttribute('href') ?? null,
      strayHrefs: [...sprite.querySelectorAll('a, image')]
        .map((node) =>
          node.getAttribute('href') ?? node.getAttributeNS(XLINK, 'href'))
        .filter(Boolean),
    }
  })

  expect(r.pwned).toBeNull()
  expect(r.forbidden).toBe(0)
  expect(r.handlerCount).toBe(0)
  expect(r.symbolCount).toBe(2)
  expect(r.pathSurvives).toBe(true)
  expect(r.fragmentUse).toBe('#icon-evil-extra')
  expect(r.strayHrefs).toEqual([])
})

test('a content sprite served with a non-SVG content-type injects nothing', async ({
  page,
}) => {
  await page.route('**/icons.svg', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<svg xmlns="http://www.w3.org/2000/svg">'
      + '<symbol id="icon-smuggled" viewBox="0 0 1 1"/></svg>',
  }))
  await page.goto('/', { waitUntil: 'networkidle' })

  // The bundled functional sprite still installs...
  await page.waitForFunction(() => {
    const host = document.querySelector('transpareo-time-machine')
    return host?.shadowRoot?.querySelector('symbol#icon-cancel') != null
  })

  // ...but the mislabeled content sprite must not.
  const smuggled = await page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    return root.querySelector('symbol#icon-smuggled') != null
  })
  expect(smuggled).toBe(false)
})
