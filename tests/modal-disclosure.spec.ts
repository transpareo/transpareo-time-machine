/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The folding sections inside the modals: «Version checks» in
 * the verification modal and «Technical details» in the event
 * modal stand open whenever their modal opens, and the reader
 * can fold them. tests/disclosure.spec.ts pins the fold across
 * re-renders.
 *
 * Runs against `npm run dev`, whose fixture DPP carries several
 * versions and an EPCIS record per event.
 */
import { test, expect, type Page } from '@playwright/test'

const PROOF = 'dpp-verification-modal details.proof-disclosure'
const EPCIS = 'dpp-event-modal details.event-modal-disclosure'

async function mount(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => {
    const tm = document.querySelector('transpareo-time-machine')
    return tm?.shadowRoot?.querySelector('dpp-hero') != null
  })
}

async function openProof(page: Page): Promise<void> {
  await page.locator('dpp-verification-chip .chip').click()
  await expect(page.locator(PROOF)).toBeVisible()
}

// Focuses the first event through the hash, then opens its
// modal from the details card.
async function openEvent(page: Page): Promise<void> {
  await page.evaluate(() => {
    const tm = document.querySelector('transpareo-time-machine')!
    const dot = tm.shadowRoot!.querySelector<HTMLElement>('[data-event-id]')!
    window.location.hash = dot.dataset.eventId!
  })
  await page.locator('.event-details-card').first().click()
  await expect(page.locator(EPCIS)).toBeVisible()
}

async function isOpen(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((d) => (d as HTMLDetailsElement).open)
}

test('the version checks stand open when the modal opens', async ({
  page,
}) => {
  await mount(page)
  await openProof(page)
  expect(await isOpen(page, PROOF)).toBe(true)

  await page.locator(`${PROOF} > summary`).click()
  expect(await isOpen(page, PROOF)).toBe(false)

  await page.keyboard.press('Escape')
  await expect(page.locator(PROOF)).toHaveCount(0)
  await openProof(page)
  expect(await isOpen(page, PROOF)).toBe(true)
})

test('the technical details stand open when the modal opens', async ({
  page,
}) => {
  await mount(page)
  await openEvent(page)
  expect(await isOpen(page, EPCIS)).toBe(true)

  await page.locator(`${EPCIS} > summary`).click()
  expect(await isOpen(page, EPCIS)).toBe(false)

  await page.keyboard.press('Escape')
  await expect(page.locator(EPCIS)).toHaveCount(0)
  await openEvent(page)
  expect(await isOpen(page, EPCIS)).toBe(true)
})
