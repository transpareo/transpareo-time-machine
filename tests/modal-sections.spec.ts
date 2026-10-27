/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * «Version checks» in the verification modal and «Technical
 * details» in the event modal are plain sections of their
 * modal: a heading over content that is always shown, with
 * nothing to fold.
 *
 * Runs against `npm run dev`, whose fixture DPP carries several
 * versions and an EPCIS record per event.
 */
import { test, expect, type Page } from '@playwright/test'

const PROOF = 'dpp-verification-modal'
const EVENT = 'dpp-event-modal'

async function mount(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => {
    const tm = document.querySelector('transpareo-time-machine')
    return tm?.shadowRoot?.querySelector('dpp-hero') != null
  })
}

test('the version checks are a plain section', async ({ page }) => {
  await mount(page)
  await page.locator('dpp-verification-chip .chip').click()

  const section = page.locator(`${PROOF} .proof-checks`)
  await expect(section.locator('h3')).toHaveText('Version checks')
  await expect(section.locator('.proof-checks-subtitle')).toBeVisible()
  await expect(section.locator('.proof-versions-list')).toBeVisible()
  await expect(page.locator(`${PROOF} details, ${PROOF} .chevron`))
    .toHaveCount(0)
})

test('the technical details are a plain section', async ({ page }) => {
  await mount(page)
  await page.evaluate(() => {
    const tm = document.querySelector('transpareo-time-machine')!
    const dot = tm.shadowRoot!.querySelector<HTMLElement>('[data-event-id]')!
    window.location.hash = dot.dataset.eventId!
  })
  await page.locator('.event-details-card').first().click()

  const card = page.locator(`${EVENT} .epcis-card`)
  await expect(card).toBeVisible()
  const heading = page.locator(`${EVENT} .event-modal-section`)
    .filter({ has: page.locator('.epcis-card') })
    .locator('h3.event-modal-subtitle')
  await expect(heading).toHaveText('Technical details')
  await expect(page.locator(`${EVENT} details, ${EVENT} .chevron`))
    .toHaveCount(0)
})
