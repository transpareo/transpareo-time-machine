// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The withdrawal band: what a passport out of circulation
 * says across the top of its own card.
 *
 * The state is the manifest's, not the snapshot's: a
 * snapshot is signed once and frozen, so the one on screen
 * was written while the passport still stood. These cover
 * the derivation reading the right artefact, the sentence
 * each void reason produces (including a reason this
 * package has never heard of), the successor a supersede
 * names, and the band staying silent for the passports
 * that stand, which is nearly all of them.
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as host from '@/host'
import { withdrawal } from '@/state'
import { locale, labelSet } from '@/i18n'
import { englishLabels, type Labels } from '@/i18n/labels'
import deLabels from '@/i18n/data/de.json'
import type { DppManifest, SignedSnapshot } from '@/archive'
import type { DppSnapshot } from '@/types'
import '@/components/dpp-withdrawal'

const org = (name: string) => (
  { '@type': 'Organization', name, did: 'did:web:x' }
)

interface ManifestState {
  voidedAt?: string
  voidedReason?: string
  supersededBy?: { code: string; url?: string }
}

// A published passport: the manifest states the carrier's
// state, and the snapshot carries the same publisher's
// issuer block, exactly as a real boot has both.
function seed(state: ManifestState): void {
  host.currentVersion.set(1)
  host.snapshots.set({
    1: {
      version: 1,
      status: 'in_use',
      proof: [],
      issuer: org('Nordic Wear'),
    } as unknown as DppSnapshot,
  })
  host.manifest.set({
    '@type': 'DppManifest',
    code: 'demo-2026-t001',
    issuer: org('Nordic Wear'),
    ...state,
  } as unknown as DppManifest)
}

// A DPP served as one document, the shape a passport URL
// answers with when there is no manifest beside it. The
// carrier state then rides the document itself.
function seedLoneDocument(state: ManifestState): void {
  host.manifest.set(null)
  host.currentVersion.set(1)
  const doc = { version: 1, product: { name: 'Tee' }, ...state }
  host.rawSnapshots.set({ 1: doc as unknown as SignedSnapshot })
  host.snapshots.set({
    1: {
      version: 1,
      status: 'in_use',
      proof: [],
      issuer: org('Atelier Barro'),
    } as unknown as DppSnapshot,
  })
}

function mount(): HTMLElement {
  const el = document.createElement('dpp-withdrawal')
  document.body.appendChild(el)
  return el
}

const text = (el: HTMLElement, sel: string): string =>
  el.querySelector(sel)?.textContent?.trim() ?? ''

afterEach(() => {
  host.manifest.set(null)
  host.rawSnapshots.set({})
  locale.set('en')
  labelSet.set(englishLabels)
  document.body.replaceChildren()
})

describe('withdrawal derivation', () => {
  it('is null for a passport that stands', () => {
    seed({})
    expect(withdrawal()).toBeNull()
  })

  it('is null with no manifest at all', () => {
    host.manifest.set(null)
    expect(withdrawal()).toBeNull()
  })

  it('reads the void off the manifest', () => {
    seed({ voidedAt: '2026-09-13T21:42:31Z', voidedReason: 'recalled' })
    expect(withdrawal()).toEqual({
      voidedAt: '2026-09-13T21:42:31Z',
      reason: 'recalled',
      successorCode: null,
      successorUrl: null,
    })
  })

  // A reason minted after this package shipped still has to
  // produce a sentence, so it folds onto `other` rather than
  // reaching the card as a raw token.
  it('folds an unknown reason onto other', () => {
    seed({ voidedAt: '2026-09-13T21:42:31Z', voidedReason: 'expired' })
    expect(withdrawal()?.reason).toBe('other')
  })

  // A lone document has no manifest to read, and the
  // publisher writes the same three keys onto the document
  // instead. Without this a withdrawn passport served that
  // way renders as a live one.
  it('falls back to a lone document stating it on itself', () => {
    seedLoneDocument({
      voidedAt: '2026-09-13T21:42:31Z', voidedReason: 'destroyed',
    })
    expect(withdrawal()?.reason).toBe('destroyed')
  })

  // An archived version says what it said on the day it
  // was signed. With a manifest present it is the manifest
  // that speaks, so a stale snapshot cannot contradict it.
  it('lets the manifest speak over any snapshot', () => {
    seed({})
    host.rawSnapshots.set({
      1: { version: 1, voidedAt: '2020-01-01T00:00:00Z' } as
        unknown as SignedSnapshot,
    })
    expect(withdrawal()).toBeNull()
  })

  // The sentence names who withdrew the passport. With no
  // manifest there is no manifest issuer to name, and the
  // sentence used to read "  withdrew its passport on ..."
  // with a hole where the publisher should be.
  it('names the issuer of a lone document too', () => {
    seedLoneDocument({
      voidedAt: '2026-09-13T21:42:31Z', voidedReason: 'destroyed',
    })
    expect(text(mount(), '.withdrawal-body'))
      .toBe('The product was destroyed, and Atelier Barro withdrew its '
        + 'passport on September 13, 2026.')
  })

  it('carries the successor a supersede names', () => {
    seed({ supersededBy: { code: 'demo-2026-t002' } })
    expect(withdrawal()).toEqual({
      voidedAt: null,
      reason: null,
      successorCode: 'demo-2026-t002',
      successorUrl: null,
    })
  })
})

describe('dpp-withdrawal', () => {
  it('renders nothing for a passport that stands', () => {
    seed({})
    expect(mount().querySelector('.withdrawal')).toBeNull()
  })

  // A void whose reason is `recalled` is a unit that went
  // back and was scrapped, not one still in someone's hands
  // under an active recall. A recall in the field keeps the
  // passport live and scannable under the suspended status,
  // which is how the person holding the unit learns of it,
  // so this sentence must not read as that notice.
  it('names the issuer and the day in the void sentence', () => {
    seed({ voidedAt: '2026-09-13T21:42:31Z', voidedReason: 'recalled' })
    const el = mount()
    expect(text(el, '.withdrawal-title'))
      .toBe('This passport has been withdrawn')
    expect(text(el, '.withdrawal-body'))
      .toBe('The product was recalled and taken out of circulation. '
        + 'Nordic Wear withdrew its passport on September 13, 2026.')
  })

  it('words each reason differently', () => {
    seed({ voidedAt: '2026-09-13T21:42:31Z', voidedReason: 'destroyed' })
    expect(text(mount(), '.withdrawal-body')).toContain('destroyed')
  })

  it('hides the successor row on a void with no successor', () => {
    seed({ voidedAt: '2026-09-13T21:42:31Z', voidedReason: 'other' })
    const row = mount().querySelector('.withdrawal-successor')
    expect((row as HTMLElement).hidden).toBe(true)
  })

  it('reads as a replacement when only superseded', () => {
    seed({ supersededBy: { code: 'demo-2026-t002' } })
    const el = mount()
    expect(text(el, '.withdrawal-title'))
      .toBe('A newer passport replaces this one')
    expect(text(el, '.withdrawal-code')).toBe('demo-2026-t002')
    expect((el.querySelector('.withdrawal-successor') as HTMLElement).hidden)
      .toBe(false)
  })

  // Both at once is the ordinary warranty exchange: the
  // replacement unit's passport is minted, and the passport
  // for the unit that went back is voided. The void is what
  // the reader needs first, with the successor under it.
  it('leads with the void when a successor exists too', () => {
    seed({
      voidedAt: '2026-09-13T21:42:31Z',
      voidedReason: 'recalled',
      supersededBy: { code: 'demo-2026-t002' },
    })
    const el = mount()
    expect(text(el, '.withdrawal-title'))
      .toBe('This passport has been withdrawn')
    expect(text(el, '.withdrawal-code')).toBe('demo-2026-t002')
  })

  it('warns on a void and points onward on a supersede', () => {
    seed({ voidedAt: '2026-09-13T21:42:31Z', voidedReason: 'other' })
    expect(mount().querySelector('.withdrawal-mark svg')?.getAttribute('class'))
      .toContain('icon-attention')

    document.body.replaceChildren()
    seed({ supersededBy: { code: 'demo-2026-t002' } })
    expect(mount().querySelector('.withdrawal-mark svg')?.getAttribute('class'))
      .toContain('icon-arrow')
  })

  // The publisher may state where the successor can be
  // read. Without an address the code is still the answer
  // to "which passport replaced this one", so it renders
  // either way and only the link comes and goes.
  it('links the successor when the publisher gave an address', () => {
    const url = 'https://demo.example/01/04012345678902'
    seed({ supersededBy: { code: 'demo-2026-t002', url } })
    const a = mount().querySelector('.withdrawal-code') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe(url)
  })

  it('leaves the code unlinked with no address', () => {
    seed({ supersededBy: { code: 'demo-2026-t002' } })
    const a = mount().querySelector('.withdrawal-code') as HTMLAnchorElement
    expect(a.hasAttribute('href')).toBe(false)
    expect(a.textContent?.trim()).toBe('demo-2026-t002')
  })

  // The address is publisher data on its way into an href,
  // which is the one place a script scheme would run.
  it('refuses a script scheme for the successor', () => {
    seed({
      supersededBy: {
        code: 'demo-2026-t002',
        url: 'javascript:alert(1)',
      },
    })
    const a = mount().querySelector('.withdrawal-code') as HTMLAnchorElement
    expect(a.hasAttribute('href')).toBe(false)
  })

  // The code is publisher data, and it lands in the DOM as
  // text rather than as markup.
  it('prints a successor code as text, never as markup', () => {
    seed({ supersededBy: { code: '<img src=x onerror=alert(1)>' } })
    const el = mount()
    expect(el.querySelector('.withdrawal-code img')).toBeNull()
    expect(text(el, '.withdrawal-code')).toBe('<img src=x onerror=alert(1)>')
  })

  // `voidedAt` is a field the renderer reads rather than
  // mints, so a publisher can write something that is not
  // a date into it. The sentence must not read "on Invalid
  // Date"; it falls back to what the manifest said.
  it('prints an unparseable date as it stands', () => {
    seed({ voidedAt: 'sometime', voidedReason: 'other' })
    const body = text(mount(), '.withdrawal-body')
    expect(body).toContain('sometime')
    expect(body).not.toContain('Invalid Date')
  })

  // The band is mounted once and the visitor can still
  // switch language under it, so the sentences are bound
  // rather than baked in at mount.
  it('follows a locale switch', () => {
    seed({ voidedAt: '2026-09-13T21:42:31Z', voidedReason: 'recalled' })
    const el = mount()
    locale.set('de')
    labelSet.set(deLabels as unknown as Labels)
    expect(text(el, '.withdrawal-title'))
      .toBe('Dieser Produktpass wurde zurückgezogen')
    expect(text(el, '.withdrawal-body')).toContain('13. September 2026')
  })
})
