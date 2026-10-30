/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The WCAG 2.2 AA gate. Loads the dev demo page
 * (nordic-wear-tshirt), waits for the SPA to finish
 * mounting, and runs axe-core over the page and over every
 * surface that opens on demand, then checks by hand what
 * axe cannot see: focus order and rings, focus kept across
 * a redraw, names a screen reader reads, reflow at 320px.
 *
 * The axe scans of the branded demo disable
 * `color-contrast`, because every pigment there derives
 * from the publisher's branding CSS (--font-color,
 * --action-color, --body-background, etc.) and its palette
 * is the publisher's to check. The renderer's own defaults
 * are ours: the contrast block serves the page with an
 * empty branding stylesheet and gates those.
 *
 * What remains for a human: reading order and wording as
 * a screen reader speaks them, and cognitive load.
 *
 * Local: run `npm run seed && npm run dev` once, then
 * `npm run browser` in another shell.
 */
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// The custom element mounts the SPA into its shadow root
// once `host.loadState === 'ready'`. Wait for the mounted
// stage so a check reads the rendered tree.
async function mount(page: Page): Promise<void> {
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => {
    const el = document.querySelector('transpareo-time-machine')
    return !!(el?.shadowRoot?.querySelector('.stage'))
  })
}

// Tab through `count` stops and name every one that shows
// no outline while focused. Hover and focus may share a
// tint, but a tint of a few percent is no indicator, so
// each stop has to draw a ring of its own.
async function stopsWithoutRing(page: Page, count: number): Promise<string[]> {
  const bare: string[] = []
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Tab')
    const stop = await page.evaluate(() => {
      let a = document.activeElement
      while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement
      if (!a || a === document.body) return null
      const ring = getComputedStyle(a).outlineStyle
      return ring === 'none' ? `${a.tagName.toLowerCase()}.${a.className}` : null
    })
    if (stop) bare.push(stop)
  }
  return bare
}

// Contrast of every match against the first opaque
// background behind it: its text colour, or for a timeline
// dot the ::before that paints it, at that layer's opacity.
// The canvas resolves whatever colour syntax the browser
// computed, color-mix with alpha included.
function ratios(
  page: Page, selector: string, paint: 'text' | 'dot'
): Promise<number[]> {
  return page.locator(selector).evaluateAll((els, paint) => {
    const cv = document.createElement('canvas').getContext('2d')!
    const rgba = (c: string): number[] => {
      cv.clearRect(0, 0, 1, 1)
      cv.fillStyle = c
      cv.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = cv.getImageData(0, 0, 1, 1).data
      return [r, g, b, a / 255]
    }
    const lum = (c: number[]): number => {
      const [r, g, b] = c.slice(0, 3).map((v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const behind = (el: Element): number[] => {
      for (let p: Element | null = el; p; p = p.parentElement) {
        const c = rgba(getComputedStyle(p).backgroundColor)
        if (c[3] === 1) return c
      }
      return [255, 255, 255, 1]
    }
    return els.filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => {
        const style = getComputedStyle(el, paint === 'dot' ? '::before' : null)
        const fg = rgba(paint === 'dot' ? style.backgroundColor : style.color)
        const alpha = fg[3] * (paint === 'dot' ? Number(style.opacity) : 1)
        const bg = behind(el)
        const mixed = fg.map((v, i) => v * alpha + bg[i] * (1 - alpha))
        const [hi, lo] = [lum(mixed), lum(bg)].sort((x, y) => y - x)
        return (hi + 0.05) / (lo + 0.05)
      })
  }, paint)
}

// The element keyboard focus sits on, read through the
// shadow root the passport renders into.
function focusedClass(page: Page): Promise<string> {
  return page.evaluate(() => {
    let a = document.activeElement
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement
    return a ? `${a.tagName.toLowerCase()}.${a.className}` : ''
  })
}

// A dialog takes focus on the frame after it opens; until
// then a key or a focus call still lands on the page.
function focusInDialog(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    let a = document.activeElement
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement
    return !!a?.closest('[aria-modal="true"]')
  })
}

// The language the markup declares for each text in the
// passport, in render order: a text's nearest `lang`.
function textLangs(page: Page): Promise<Array<[string, string]>> {
  return page.evaluate(() => {
    const root = document.querySelector('transpareo-time-machine')!.shadowRoot!
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const out: Array<[string, string]> = []
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const text = n.textContent!.trim()
      const lang = n.parentElement?.closest('[lang]')?.getAttribute('lang')
      if (text) out.push([text, lang ?? ''])
    }
    return out
  })
}

// The languages a text is declared in, wherever it shows.
function langsOf(pairs: Array<[string, string]>, text: string): string[] {
  return pairs.filter(([t]) => t === text).map(([, lang]) => lang)
}

// The AA violations axe finds in what is on screen now.
async function violations(page: Page, skip: string[] = []): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .disableRules(['color-contrast', ...skip])
    .analyze()
  return results.violations.map((v) => {
    const where = v.nodes.map((n) => JSON.stringify(n.target)).join(' ')
    return `${v.id}: ${where}`
  })
}

test('dev demo passes WCAG 2.2 AA (axe-core)', async ({ page }) => {
  await mount(page)
  expect(await violations(page)).toEqual([])
})

// The closed page is a fraction of what a visitor reaches:
// every surface that opens on demand gets the same scan.
test('every opened surface passes WCAG 2.2 AA (axe-core)', async ({
  page
}) => {
  await mount(page)

  // Close neighbours in time draw their dots closer than
  // 24px apart. The 2.5.8 exception for an equivalent
  // control covers them: the 32px arrows either side of
  // the details step through the same events one by one.
  await page.locator('.versions-toggle').click()
  await page.waitForTimeout(500)
  expect(await violations(page, ['target-size'])).toEqual([])
  const arrow = await page.locator('.nav-arrow-prev').boundingBox()
  expect(Math.min(arrow!.width, arrow!.height)).toBeGreaterThanOrEqual(24)

  await page.locator('.locale-switch').click()
  expect(await violations(page, ['target-size'])).toEqual([])
  await page.keyboard.press('Escape')
  await page.locator('.locale-switch').click()

  const openers: Array<[string, string]> = [
    ['.event-details-card', 'dpp-event-modal.open'],
    ['.chip.clickable', 'dpp-verification-modal.open'],
    ['.dpp-comp-name-trigger', 'dpp-library-modal.open'],
    ['.gallery-image', 'dpp-lightbox.open']
  ]
  for (const [opener, surface] of openers) {
    await page.locator(opener).first().click()
    await expect(page.locator(surface)).toBeVisible()
    await page.waitForTimeout(300)
    expect(await violations(page, ['target-size']), surface).toEqual([])
    await page.keyboard.press('Escape')
    await expect(page.locator(surface)).toBeHidden()
  }
})

// The renderer's own colours, with no branding stylesheet:
// what a publisher gets for every token it leaves unset.
// A publisher's own palette is theirs to check; these
// defaults are ours.
test.describe('default theme contrast', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/branding.css', (route) => route.fulfill({
      contentType: 'text/css',
      body: ''
    }))
  })

  test('text reaches 4.5:1 (axe-core)', async ({ page }) => {
    await mount(page)
    const contrast = async (): Promise<string[]> => {
      const results = await new AxeBuilder({ page })
        .withRules(['color-contrast'])
        .analyze()
      return results.violations.flatMap((v) => v.nodes.map((n) => n.html))
    }
    expect(await contrast()).toEqual([])

    await page.locator('.versions-toggle').click()
    await page.waitForTimeout(500)
    expect(await contrast()).toEqual([])
  })

  // The timeline's muted text is mixed from the font colour
  // with alpha, which axe leaves undecided, so it is measured
  // here.
  test('the timeline text reaches 4.5:1 on the trough', async ({ page }) => {
    await mount(page)
    await page.locator('.versions-toggle').click()
    await page.waitForTimeout(500)

    for (const sel of ['.tick-label', '.event-details-date', '.versions-label']) {
      const lowest = Math.min(...await ratios(page, sel, 'text'))
      expect(lowest, sel).toBeGreaterThanOrEqual(4.5)
    }

    await page.locator('.open-full-btn').click()
    await page.waitForTimeout(500)
    const cards = await ratios(page, '.panel-card-date', 'text')
    expect(cards.length).toBeGreaterThan(0)
    expect(Math.min(...cards)).toBeGreaterThanOrEqual(4.5)
  })

  test('timeline dots reach 3:1 on the trough', async ({ page }) => {
    await mount(page)
    await page.locator('.versions-toggle').click()
    await page.waitForTimeout(500)

    const dots = await ratios(page, '.strip .event:not(.active)', 'dot')
    expect(dots.length).toBeGreaterThan(0)
    expect(Math.min(...dots)).toBeGreaterThanOrEqual(3)
  })
})

// 320 CSS px is 1280 at 400% zoom. German brings the long
// compounds ("Materialzusammensetzung"), and the 1.4.12
// spacing makes them longer still.
test.describe('reflow at 320px', () => {
  test.use({ locale: 'de-DE', viewport: { width: 320, height: 800 } })

  test('no heading runs out of its box', async ({ page }) => {
    await mount(page)
    await page.evaluate(() => {
      const root = document.querySelector('transpareo-time-machine')!
      const style = document.createElement('style')
      style.textContent = `* {
        line-height: 1.5 !important;
        letter-spacing: 0.12em !important;
        word-spacing: 0.16em !important;
      }
      p { margin-bottom: 2em !important; }`
      root.shadowRoot!.appendChild(style)
    })

    const spilled = await page.locator('h1, h2, h3').evaluateAll((hs) =>
      hs.filter((h) => h.scrollWidth > h.clientWidth + 1)
        .map((h) => h.textContent))
    expect(spilled).toEqual([])
    const [scrolled, shown] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth
    ])
    expect(scrolled).toBeLessThanOrEqual(shown)
  })
})

// A workspace offers every language it speaks, also those a
// publisher left rows untranslated in, and the reader of such
// a row gets it in the fallback language. The demo carries
// every row in each of its languages, so the manifest offers
// one more here: in Italian every value falls back to English.
test.describe('language of parts', () => {
  test.use({ locale: 'it-IT' })

  test.beforeEach(async ({ page }) => {
    await page.route('**/manifest.json', async (route) => {
      const response = await route.fetch()
      const json = await response.json()
      json.availableLocales.push('it')
      await route.fulfill({ response, json })
    })
  })

  test('untranslated text declares its language', async ({ page }) => {
    await mount(page)
    await expect(page.locator('.tm-content[lang="it"]')).toHaveCount(1)
    await page.locator('.dpp-accordion-header').first().click()

    const pairs = await textLangs(page)
    const english = [
      'Essential Crew Neck T-Shirt',
      'T-Shirts',
      'Colour',
      'Indigo Blue',
      'Care instructions',
      'Wash at 30 C; line dry; iron at low heat.',
      'Intended use',
      'Daily wear',
      'Material composition',
      'Organic Cotton'
    ]
    for (const text of english) {
      const langs = langsOf(pairs, text)
      expect(langs.length, text).toBeGreaterThan(0)
      expect(new Set(langs), text).toEqual(new Set(['en']))
    }

    // A country is named in the reader's language and
    // inherits the page's.
    expect(langsOf(pairs, 'Portogallo')).toEqual(['it'])
  })

  test('so does untranslated text in a dialog', async ({ page }) => {
    await mount(page)
    await page.locator('.dpp-comp-name-trigger').first().click()
    await expect(page.locator('.dpp-library-panel:not(.loading)')).toBeVisible()

    const pairs = await textLangs(page)
    for (const text of ['Alternative names', 'Bio cotton', 'Origin']) {
      expect(langsOf(pairs, text), text).toEqual(['en'])
    }

    // The dialog is named by its title, which says the
    // component's name in that name's language.
    const dialog = page.locator('dpp-library-modal')
    const title = dialog.locator('.modal-title')
    await expect(dialog).toHaveAttribute('aria-labelledby', /\S/)
    await expect(title.locator('[lang="en"]')).toHaveText('Organic Cotton')
    await page.keyboard.press('Escape')

    await page.locator('.gallery-image').first().click()
    const picture = page.locator('dpp-lightbox .gallery-image')
    await expect(picture).toHaveAttribute('lang', 'en')
    await expect(picture).toHaveAttribute('alt', /^Essential Crew Neck/)
  })
})

test.describe('screen reader', () => {
  test('timeline dots name their event and mark the shown one', async ({
    page
  }) => {
    await mount(page)
    await page.locator('.versions-toggle').click()

    // Four lifecycle events read "Lifecycle" four times
    // unless each also says when it happened.
    const names = await page.locator('.strip .event')
      .evaluateAll((dots) => dots.map((d) => d.getAttribute('aria-label')))
    expect(new Set(names).size).toBe(names.length)
    expect(names[0]).toMatch(/^Published, \S+/)

    const current = page.locator('.strip .event[aria-current="true"]')
    await expect(current).toHaveCount(1)
    await expect(current).toHaveClass(/active/)

    // The details card is named for the event it shows, not
    // only for the action of opening it.
    const card = page.locator('.event-details-card')
    const label = await card.getAttribute('aria-label')
    const tag = await card.locator('.event-tag').textContent()
    expect(label).toContain(tag!)
  })

  test('the verification verdict is announced', async ({ page }) => {
    await mount(page)
    const status = page.getByRole('status').filter({ hasText: 'Verified' })
    await expect(status).toHaveCount(1)
  })

  test('the copy confirmation is announced', async ({ page }) => {
    await mount(page)
    await page.locator('.versions-toggle').click()
    await page.locator('.event-details-card').click()

    // "Copied" replaces the button's text where focus already
    // is, which a screen reader does not read out unless the
    // button is a live region.
    const copy = page.locator('.epcis-copy')
    await expect(copy).toHaveAttribute('aria-live', 'polite')
  })

  test('a modal opened by an integration is named', async ({ page }) => {
    await mount(page)
    await page.evaluate(() => {
      const tm = document.querySelector('transpareo-time-machine') as
        HTMLElement & { openModal(o: { title: string, body: string }): void }
      tm.openModal({ title: 'Recall notice', body: 'Return the item.' })
    })
    const dialog = page.getByRole('dialog', { name: 'Recall notice' })
    await expect(dialog).toBeVisible()
  })
})

test.describe('keyboard', () => {
  test('the collapsed timeline takes no focus', async ({ page }) => {
    await mount(page)

    // The strip is collapsed to nothing above the card, so a
    // dot that took focus there would hold an invisible ring.
    // The first stop is the toggle that opens the history.
    await page.keyboard.press('Tab')
    expect(await focusedClass(page)).toBe('button.versions-toggle')

    // Opened, the dots are stops again, ahead of the toggle.
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    expect(await focusedClass(page)).toMatch(/^button\.event/)
  })

  test('every stop draws a focus ring', async ({ page }) => {
    await mount(page)
    expect(await stopsWithoutRing(page, 30)).toEqual([])

    // The picker's rows are stops of their own once it opens.
    await page.locator('.locale-switch').focus()
    await page.keyboard.press('Enter')
    expect(await stopsWithoutRing(page, 3)).toEqual([])
    await page.keyboard.press('Escape')

    // So are the buttons of an event's modal, its technical
    // section included.
    await page.locator('.versions-toggle').click()
    await page.locator('.event-details-card').click()
    await expect(page.locator('dpp-event-modal.open')).toBeVisible()
    expect(await stopsWithoutRing(page, 8)).toEqual([])
  })

  test('the language picker hands focus back', async ({ page }) => {
    await mount(page)
    const toggle = page.locator('.locale-switch')
    const menu = page.locator('.locale-menu')

    // Escape closes the menu from the trigger and from a row,
    // and either way focus is on the trigger after.
    await toggle.focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    expect(await focusedClass(page)).toBe('button.locale-switch')

    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowDown')
    expect(await focusedClass(page)).toMatch(/^button/)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    expect(await focusedClass(page)).toBe('button.locale-switch')

    // A pick re-renders the passport in the new language;
    // focus comes back to the trigger of the new tree.
    await page.locator('.stage').evaluate((s) => s.setAttribute('data-old', ''))
    await page.keyboard.press('Enter')
    await page.locator('.locale-list button[data-code="de"]').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.stage[data-old]')).toHaveCount(0)
    await expect(page.locator('.tm-content[lang="de"] .stage')).toBeVisible()
    expect(await focusedClass(page)).toBe('button.locale-switch')
  })

  test('arrow keys in an open dialog stay in the dialog', async ({ page }) => {
    await mount(page)
    await page.locator('.versions-toggle').click()
    const shown = (): Promise<string | null> => page
      .locator('.strip .event[aria-current="true"]')
      .getAttribute('data-event-id')
    const before = await shown()

    // The open timeline steps through versions on the arrow
    // keys; a dialog on top uses them for its own content.
    await page.locator('.gallery-image').click()
    await expect(page.locator('dpp-lightbox.open')).toBeVisible()
    await expect.poll(() => focusInDialog(page)).toBe(true)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Escape')
    await page.locator('.event-details-card').click()
    await expect(page.locator('dpp-event-modal.open')).toBeVisible()
    await expect.poll(() => focusInDialog(page)).toBe(true)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Escape')
    expect(await shown()).toBe(before)
  })

  test('paging the pictures keeps focus on the pager', async ({ page }) => {
    await mount(page)

    // Each step redraws the pager; focus stays on the control
    // that was pressed, or on the current page once that
    // control has nothing left to step to.
    await page.locator('dpp-gallery [data-action="next"]').focus()
    await page.keyboard.press('Enter')
    expect(await focusedClass(page)).toBe('span.next btn')
    await page.keyboard.press('Enter')
    expect(await focusedClass(page)).toBe('span.btn current')
    await page.locator('dpp-gallery [data-page="2"]').focus()
    await page.keyboard.press('Enter')
    expect(await focusedClass(page)).toBe('span.btn current')

    // The lightbox shares the pager, and focus must not drop
    // out of the dialog onto the page behind it.
    await page.locator('.gallery-image').click()
    await expect(page.locator('dpp-lightbox.open')).toBeVisible()
    await expect.poll(() => focusInDialog(page)).toBe(true)
    await page.locator('dpp-lightbox [data-action="prev"]').focus()
    await page.keyboard.press('Enter')
    expect(await focusedClass(page)).toBe('span.btn current')
    await page.locator('dpp-lightbox [data-page="3"]').focus()
    await page.keyboard.press('Enter')
    expect(await focusedClass(page)).toBe('span.btn current')
  })
})
