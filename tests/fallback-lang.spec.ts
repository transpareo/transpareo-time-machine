// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * WCAG 3.1.2, language of parts. A passport offers every
 * language its publisher's workspace speaks, and a row the
 * publisher never translated reaches a reader in another
 * one. That text has to declare its own language, or a
 * screen reader speaks English words with French phonemes.
 * Text in the reader's language inherits the page's and
 * carries none of its own.
 *
 * The browser gate (a11y.spec.ts) walks the demo page in a
 * language it has no translations for. These cases cover
 * what the demo does not show: the property table's notes,
 * an event's description and the names in its change set.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import * as host from '@/host'
import { locale } from '@/i18n'
import { fetchStateByVersion } from '@/private-properties'
import { eventModalEventId } from '@/components/dpp-event-modal'
import {
  REGION_DATATYPE, txLang, type DppSnapshot, type PropertyValue,
} from '@/types'
import type { EpcisDocument } from '@/epcis'
import '@/components/dpp-properties'

const COMPONENTS = `${import.meta.dirname}/../src/components/`

describe('txLang', () => {
  it('names no language for text in the reader locale', () => {
    expect(txLang({ en: 'Care', fr: 'Soin' }, 'fr')).toEqual(['Soin'])
  })

  it('names the fallback language it fell back to', () => {
    expect(txLang({ de: 'Pflege', en: 'Care' }, 'fr')).toEqual(['Care', 'en'])
  })

  it('names the first language when the fallback is missing too', () => {
    expect(txLang({ de: 'Pflege' }, 'fr')).toEqual(['Pflege', 'de'])
  })

  it('names no language where it cannot know one', () => {
    expect(txLang('GOTS Organic', 'fr')).toEqual(['GOTS Organic'])
    expect(txLang(undefined, 'fr')).toEqual([''])
    expect(txLang({}, 'fr')).toEqual([''])
  })

  it('names a country in the reader language, untagged', () => {
    const pt = { '@value': 'PT', '@type': REGION_DATATYPE }
    expect(txLang(pt, 'fr')).toEqual(['Portugal'])
  })
})

// The values below spell their language as a prefix
// ("en:Reading"), so a text whose markup declares another
// language, or none of its own, shows up by name.
function mislabelled(root: Element): string[] {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const out: string[] = []
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const lang = n.parentElement!.closest('[lang]')!.getAttribute('lang')
    for (const [value, code] of n.textContent!.matchAll(/(en|de|fr):\w+/g)) {
      if (code !== lang) out.push(`${value} declared ${lang}`)
    }
  }
  return out
}

function scalar(
  key: string, name: Record<string, string>, value: Record<string, string>,
): PropertyValue {
  return { key, name, namespace: key, value: { type: 'scalar', value } }
}

// A French reader on a page that declares French.
function mountPage(tag: string): HTMLElement {
  const page = document.createElement('div')
  page.lang = 'fr'
  page.append(document.createElement(tag))
  document.body.append(page)
  return page
}

beforeEach(() => {
  document.body.replaceChildren()
  locale.set('fr')
  fetchStateByVersion.set({})
})

describe('a value in another language', () => {
  it('declares it in the property table', () => {
    const article = scalar('a', { en: 'en:Article' }, { fr: 'fr:Valeur' })
    host.currentVersion.set(1)
    host.snapshots.set({ 1: { properties: [article] } as unknown as DppSnapshot })

    // A reading sealed at publish says so in the reader's
    // language, beside the fallback value it annotates.
    const sealed = scalar('r', { fr: 'fr:Mesure' }, { de: 'de:Wert' })
    const reading = { ...sealed, dynamic: true as const }
    fetchStateByVersion.set({ 1: { status: 'ok', rows: [reading] } })
    const page = mountPage('dpp-properties')

    for (const text of ['en:Article', 'fr:Valeur', 'fr:Mesure', 'de:Wert']) {
      expect(page.textContent).toContain(text)
    }
    expect(mislabelled(page)).toEqual([])
    expect(page.querySelectorAll('[lang="fr"]')).toHaveLength(0)
    const note = page.querySelector('.dpp-property-note')!
    expect(note.closest('[lang]')).toBe(page)
  })

  it('declares it in an event and the names it changed', () => {
    const before = scalar('k1', { de: 'de:Farbe' }, { fr: 'fr:Bleu' })
    const added = scalar('k2', { en: 'en:Size' }, { fr: 'fr:M' })
    const changedProperties = { added: ['k2'], modified: ['k1'], removed: [] }
    host.currentVersion.set(2)
    host.snapshots.set({
      1: { version: 1, properties: [before] },
      2: { version: 2, properties: [before, added], changedProperties }
    } as unknown as Record<number, DppSnapshot>)
    host.epcisDocument.set({
      epcisBody: {
        eventList: [{
          type: 'ObjectEvent',
          eventID: 'urn:uuid:e1',
          eventTime: '2026-03-01T10:00:00Z',
          eventTimeZoneOffset: '+00:00',
          action: 'OBSERVE',
          epcList: [],
          'transpareo:dppEventId': 'e1',
          'transpareo:eventType': 'published',
          'transpareo:versionNumber': 2,
          'transpareo:description': { en: 'en:Published', de: 'de:Neu' }
        }]
      }
    } as unknown as EpcisDocument)
    const page = mountPage('dpp-event-modal')
    eventModalEventId.set('e1')

    // The raw record is JSON, in no human language.
    page.querySelector('.epcis-json')!.remove()

    const changed = page.querySelector('.change-set-names')
    expect(changed?.textContent).toBe('en:Size')
    expect(page.textContent).toContain('de:Farbe')
    expect(page.textContent).toContain('en:Published')
    expect(mislabelled(page)).toEqual([])
    expect(page.querySelectorAll('[lang="fr"]')).toHaveLength(0)
    eventModalEventId.set(null)
  })
})

// tx() resolves a value and drops the language it fell back
// to, so a render surface reaches for txLang(). Two stay on
// tx() on purpose.
describe('the render surfaces', () => {
  const allowed: Record<string, string> = {
    // The hero image is named "View full size" in the
    // reader's language; the product name only fills its alt.
    'dpp-gallery.ts': 'alt behind a reader-language name',

    // A country code or a spelled-out name, never a locale map.
    'dpp-manufacturer.ts': 'no locale map reaches it'
  }

  it('resolve every value with its language', () => {
    const files = readdirSync(COMPONENTS, { recursive: true, encoding: 'utf8' })
    const offenders = files
      .filter((f) => f.endsWith('.ts') && !(f in allowed))
      .filter((f) => /\btx\(/.test(readFileSync(COMPONENTS + f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
