// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The files a passport pinned, all under the Downloads section
 * after the accordions: its own, and those a property points
 * at. Such a property keeps its place on the card and jumps
 * to its file.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as host from '@/host'
import { locale } from '@/i18n'
import { fetchStateByVersion } from '@/private-properties'
import type { DppDocument, DppSnapshot, PropertyValue } from '@/types'
import '@/components/dpp-downloads'
import '@/components/dpp-properties'
import '@/components/dpp-property-cards'

const GUIDE = 'https://cdn.example.com/media/acme/files/9f86.pdf'
const GUIDE_DE = 'https://cdn.example.com/media/acme/files/4e07.pdf'
const CERT = 'https://cdn.example.com/media/acme/files/c3a1.pdf'

const guide: DppDocument = {
  name: { en: 'Care guide', de: 'Pflegeanleitung' },
  type: 'manual',
  files: [{ href: GUIDE }, { href: GUIDE_DE, languages: ['de'] }]
}

const certificate: DppDocument = {
  name: { en: 'Textile certificate' },
  type: 'certificate',
  issuer: 'Atlantic Textile Testing',
  number: 'ATT-2023-41877',
  validUntil: '2000-06-30',
  files: [{ href: CERT }]
}

function show(
  downloads?: ReadonlyArray<DppDocument>,
  properties: ReadonlyArray<PropertyValue> = []
): void {
  const product = { images: [], ...(downloads ? { downloads } : {}) }
  const snapshot = { version: 1, product, properties }
  host.snapshots.set({ 1: snapshot as unknown as DppSnapshot })
}

function mount(tag: string): HTMLElement {
  const node = document.createElement(tag)
  document.body.appendChild(node)
  return node
}

function rowFor(root: Element, href: string): Element | null {
  const link = root.querySelector(`a[href="${href}"]`)
  return link?.closest('.dpp-document') ?? null
}

beforeEach(() => {
  document.body.replaceChildren()
  locale.set('en')
  host.currentVersion.set(1)
  fetchStateByVersion.set({})
})

describe('the Downloads section', () => {
  it('shows nothing for a passport without downloads', () => {
    show()
    const section = mount('dpp-downloads')
    expect(section.children).toHaveLength(0)
  })

  it('lists each download under its heading', () => {
    show([guide, certificate])
    const section = mount('dpp-downloads')

    const heading = section.querySelector('h2')
    expect(heading?.textContent?.trim()).toBe('Downloads')
    expect(heading?.firstElementChild?.matches('svg.icon-download')).
      toBe(true)
    const links = section.querySelectorAll('.dpp-document a.dpp-ext-link')
    expect([...links].map((a) => a.textContent)).
      toEqual(['Care guide', 'Textile certificate'])
  })

  it('opens the file in a new tab beside its extension', () => {
    show([guide])
    const link = mount('dpp-downloads').querySelector('a')!

    expect(link.getAttribute('href')).toBe(GUIDE)
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noopener noreferrer')
    const symbol = link.querySelector('.dpp-file-icon')!
    expect(symbol.querySelector('svg.icon-file')).not.toBeNull()
    expect(symbol.getAttribute('data-ext')).toBe('PDF')
    expect(symbol.getAttribute('aria-hidden')).toBe('true')
    expect(link.textContent).toBe('Care guide')
  })

  it('reads the extension off the address, query and all', () => {
    const sheet = 'https://cdn.example.com/files/a1b2.xlsx?v=3#top'
    const bare = 'https://cdn.example.com/files/a1b2'
    show([
      { ...guide, files: [{ href: sheet }] },
      { ...certificate, files: [{ href: bare }] }
    ])
    const section = mount('dpp-downloads')

    const ext = (href: string): string | null | undefined => rowFor(
      section, href)?.querySelector('.dpp-file-icon')?.getAttribute('data-ext')
    expect(ext(sheet)).toBe('XLSX')
    expect(ext(bare)).toBeNull()
  })

  it('names the type and the details the publisher recorded', () => {
    show([certificate])
    const row = rowFor(mount('dpp-downloads'), CERT)!

    expect(row.querySelector('.dpp-document-type')?.textContent).
      toBe('Certificate')
    const details = [...row.querySelectorAll('dt')].map((dt) => [
      dt.textContent, dt.nextElementSibling?.textContent
    ])
    expect(details).toEqual([
      ['Issued by', 'Atlantic Textile Testing'],
      ['Number', 'ATT-2023-41877'],
      ['Valid until', 'June 30, 2000 Expired']
    ])
  })

  it('marks a document whose validity has run out', () => {
    const current = { ...certificate, validUntil: '2999-12-31' }
    show([certificate, current])
    const section = mount('dpp-downloads')

    const badges = section.querySelectorAll('.dpp-document-expired')
    expect(badges).toHaveLength(1)
    expect(badges[0].textContent).toBe('Expired')
    expect(badges[0].closest('.dpp-document')).toBe(rowFor(section, CERT))
  })

  it('offers the language version in the reader language', () => {
    show([guide])
    locale.set('de')
    const link = mount('dpp-downloads').querySelector('a')!
    expect(link.getAttribute('href')).toBe(GUIDE_DE)
    expect(link.textContent).toBe('Pflegeanleitung')
  })

  it('offers the file for every language to anyone else', () => {
    show([guide])
    locale.set('fr')
    const link = mount('dpp-downloads').querySelector('a')!
    expect(link.getAttribute('href')).toBe(GUIDE)
    expect(link.lang).toBe('en')
  })

  it('leaves a file with a script address as plain text', () => {
    const unsafe = { ...guide, files: [{ href: 'javascript:alert(1)' }] }
    show([unsafe])
    const section = mount('dpp-downloads')
    expect(section.querySelector('a')).toBeNull()
    expect(section.querySelector('.dpp-document')?.textContent).
      toContain('Care guide')
  })
})

describe('a property pointing at a file', () => {
  const declaration: PropertyValue = {
    key: 'declarationOfConformity',
    name: { en: 'Declaration of conformity' },
    value: { type: 'link', href: CERT, document: certificate }
  }

  const colour: PropertyValue = {
    key: 'colour',
    name: { en: 'Colour' },
    value: { type: 'scalar', value: { en: 'Indigo' } }
  }

  const restricted = { ...declaration, namespace: 'transpareo:doc' }

  it('lists the file under Downloads, after the pinned ones', () => {
    show([guide], [declaration])
    const section = mount('dpp-downloads')

    const links = section.querySelectorAll('.dpp-document a.dpp-ext-link')
    expect([...links].map((a) => a.textContent)).
      toEqual(['Care guide', 'Declaration of conformity'])
    const row = rowFor(section, CERT)!
    expect(row.querySelector('.dpp-document-expired')).not.toBeNull()
  })

  it('stands as a tile naming its type among the others', () => {
    show(undefined, [colour, declaration])
    const cards = mount('dpp-property-cards')

    const labels = [...cards.querySelectorAll('.dpp-metric-label')]
    expect(labels.map((l) => l.textContent?.trim())).
      toEqual(['Colour', 'Declaration of conformity'])
    const value = cards.querySelectorAll('.dpp-metric-value')[1]
    expect(value.textContent).toBe('Certificate')
    const jump = labels[1].firstElementChild!
    expect(jump.matches('button.dpp-download-jump')).toBe(true)
    expect(jump.getAttribute('aria-label')).
      toBe('Show Declaration of conformity under Downloads')
    expect(jump.querySelector('svg.icon-download')).not.toBeNull()
  })

  it('leaves the property list without a row of its own', () => {
    show(undefined, [declaration])
    const list = mount('dpp-properties')
    expect(list.querySelector('.dpp-property-row')).toBeNull()
  })

  it('scrolls to the file and puts focus on its link', () => {
    show(undefined, [declaration])
    const cards = mount('dpp-property-cards')
    const section = mount('dpp-downloads')
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => {})

    cards.querySelector<HTMLElement>('.dpp-download-jump')!.click()

    expect(scroll).toHaveBeenCalledOnce()
    expect(scroll.mock.contexts[0]).toBe(rowFor(section, CERT))
    expect(document.activeElement).toBe(section.querySelector('a'))
    scroll.mockRestore()
  })

  it('names a namespaced one in the list, beside its jump', () => {
    show(undefined, [restricted])
    const list = mount('dpp-properties')

    const row = list.querySelector('.dpp-property-row')!
    const label = row.querySelector('.dpp-property-label')!
    expect(label.textContent?.trim()).toBe('Declaration of conformity')
    expect(label.firstElementChild?.matches('.dpp-download-jump')).
      toBe(true)
    expect(row.querySelector('.dpp-property-value')?.textContent).
      toBe('Certificate')
    expect(row.querySelector('a')).toBeNull()
  })

  it('lists a restricted file once the reader is served it', () => {
    show()
    fetchStateByVersion.set({ 1: { status: 'ok', rows: [restricted] } })
    const list = mount('dpp-properties')
    const section = mount('dpp-downloads')

    expect(list.querySelector('.dpp-download-jump')).not.toBeNull()
    expect(rowFor(section, CERT)?.querySelector('a')?.textContent).
      toBe('Declaration of conformity')
  })

  it('keeps the file of a property still on demand out', () => {
    show(undefined, [{ ...restricted, onDemand: true }])
    const section = mount('dpp-downloads')
    expect(section.children).toHaveLength(0)
  })

  it('keeps a link that pins no file a plain link', () => {
    const plain = { ...declaration, value: { type: 'link', href: CERT } }
    show(undefined, [plain as PropertyValue])
    const list = mount('dpp-properties')
    expect(list.querySelector('.dpp-document')).toBeNull()
    expect(list.querySelector('a svg')).toBeNull()
  })
})
