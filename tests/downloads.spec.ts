// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The files a passport pinned, after the accordions: a section
 * for each property naming files, in the order of the
 * passport's properties, then the passport's own documents.
 */

import { describe, it, expect, beforeEach } from 'vitest'
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
    expect(heading?.textContent?.trim()).toBe('Documents')
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
    const data = 'https://cdn.example.com/files/a1b2.csv?v=3#top'
    const bare = 'https://cdn.example.com/files/a1b2'
    show([
      { ...guide, files: [{ href: data }] },
      { ...certificate, files: [{ href: bare }] }
    ])
    const section = mount('dpp-downloads')

    const ext = (href: string): string | null | undefined => rowFor(
      section, href)?.querySelector('.dpp-file-icon')?.getAttribute('data-ext')
    expect(ext(data)).toBe('CSV')
    expect(ext(bare)).toBeNull()
  })

  // The common four-letter types read in their three-letter form,
  // at the size a PDF's does.
  it('names a common four-letter type in three letters', () => {
    const files = ['docx', 'xlsx', 'pptx', 'jpeg', 'tiff'].map((ext) => ({
      ...guide, files: [{ href: `https://cdn.example.com/f/a.${ext}` }]
    }))
    show(files)
    const section = mount('dpp-downloads')

    const icons = [...section.querySelectorAll('.dpp-file-icon')]
    expect(icons.map((i) => i.getAttribute('data-ext'))).
      toEqual(['DOC', 'XLS', 'PPT', 'JPG', 'TIF'])
    expect(icons.some((i) => i.classList.contains('long'))).toBe(false)
  })

  // Any other longer one stacks in two rows inside the page.
  it('splits a longer extension into two rows', () => {
    const data = 'https://cdn.example.com/files/a1b2.json'
    show([guide, { ...certificate, files: [{ href: data }] }])
    const section = mount('dpp-downloads')

    const icon = rowFor(section, data)!.querySelector('.dpp-file-icon')!
    expect(icon.classList.contains('long')).toBe(true)
    expect(icon.getAttribute('data-ext')).toBe('JSON')
    expect([icon.getAttribute('data-ext-head'),
      icon.getAttribute('data-ext-tail')]).toEqual(['JS', 'ON'])
    const pdf = rowFor(section, GUIDE)!.querySelector('.dpp-file-icon')!
    expect(pdf.classList.contains('long')).toBe(false)
  })

  // A date long past reads as the date alone.
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
      ['Valid until', 'June 30, 2000']
    ])
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

describe('a property naming files', () => {
  const declaration: PropertyValue = {
    key: 'declarationOfConformity',
    name: { en: 'Declaration of conformity' },
    value: { type: 'link', entries: [{ href: CERT, document: certificate }] }
  }

  const manual: PropertyValue = {
    key: 'manual',
    name: { en: 'Manual' },
    value: { type: 'link', entries: [{ href: GUIDE, document: guide }] }
  }

  const colour: PropertyValue = {
    key: 'colour',
    name: { en: 'Colour' },
    value: { type: 'scalar', value: { en: 'Indigo' } }
  }

  const restricted = { ...declaration, namespace: 'transpareo:doc' }

  // The card's own title, then one heading per property.
  const titles = (root: Element): Array<string | undefined> =>
    [...root.querySelectorAll('h2, h3')].map((h) => h.textContent?.trim())

  it('gets a group of its own, before the general documents', () => {
    show([guide], [declaration])
    const section = mount('dpp-downloads')

    expect(titles(section)).
      toEqual(['Documents', 'Declaration of conformity'])
    const row = rowFor(section, CERT)!
    const group = row.closest('section')!
    expect(group.querySelector('h3')?.textContent?.trim()).
      toBe('Declaration of conformity')
    expect(row.querySelector('a')?.textContent).toBe('Textile certificate')

    const own = rowFor(section, GUIDE)!.closest('section')!
    expect(own.querySelector('h3')).toBeNull()
    expect(own.previousElementSibling).toBe(group)
  })

  it('follows the order the passport lists its properties in', () => {
    show(undefined, [manual, colour, declaration])
    const section = mount('dpp-downloads')
    expect(titles(section)).
      toEqual(['Documents', 'Manual', 'Declaration of conformity'])
  })

  it('lists its entries in order, a web address as a plain link', () => {
    const portal = { href: 'https://acme.example/reach', name: 'REACH portal' }
    const value = {
      type: 'link',
      entries: [{ href: CERT, document: certificate }, portal,
        { href: GUIDE, document: guide }]
    } as const
    show(undefined, [{ ...declaration, value }])
    const section = mount('dpp-downloads')

    const links = [...section.querySelectorAll('a')]
    expect(links.map((a) => a.textContent)).
      toEqual(['Textile certificate', 'REACH portal', 'Care guide'])
    expect(links[1].closest('.dpp-document')).toBeNull()
    expect(links[1].querySelector('.dpp-file-icon')).toBeNull()
    expect(links[1].target).toBe('_blank')
  })

  it('shows neither as a tile nor in the property list', () => {
    show(undefined, [colour, declaration])
    const cards = mount('dpp-property-cards')
    const list = mount('dpp-properties')

    const labels = [...cards.querySelectorAll('.dpp-metric-label')]
    expect(labels.map((l) => l.textContent?.trim())).toEqual(['Colour'])
    expect(list.querySelector('.dpp-property-row')).toBeNull()
  })

  it('shows a restricted one once the reader is served it', () => {
    const lab = { ...restricted, key: 'lab', name: { en: 'Lab report' } }
    show(undefined, [declaration])
    fetchStateByVersion.set({ 1: { status: 'ok', rows: [lab] } })
    const section = mount('dpp-downloads')
    const list = mount('dpp-properties')

    expect(titles(section)).
      toEqual(['Documents', 'Declaration of conformity', 'Lab report'])
    expect(list.querySelector('.dpp-property-row')).toBeNull()
  })

  it('keeps the files of a property still on demand out', () => {
    show(undefined, [{ ...restricted, onDemand: true }])
    const section = mount('dpp-downloads')
    expect(section.children).toHaveLength(0)
  })

  it('keeps a lone web address a plain link in the list', () => {
    const value = { type: 'link', entries: [{ href: CERT }] } as const
    show(undefined, [{ ...declaration, value }])
    const list = mount('dpp-properties')

    const link = list.querySelector('a.dpp-ext-link')!
    expect(link.textContent).toBe('Declaration of conformity')
    expect(link.getAttribute('href')).toBe(CERT)
    expect(mount('dpp-downloads').children).toHaveLength(0)
  })

  // A link field naming several web addresses and no file
  // keeps its place, its addresses beside its name.
  it('lists several web addresses beside the name', () => {
    const value = {
      type: 'link',
      entries: [{ href: 'https://a.example/', name: 'Shop' },
        { href: 'https://b.example/care' }]
    } as const
    show(undefined, [{ ...colour, key: 'sites', name: { en: 'Sites' }, value }])
    const row = mount('dpp-properties').querySelector('.dpp-property-row')!

    expect(row.querySelector('.dpp-property-label')?.textContent).
      toBe('Sites')
    const links = [...row.querySelectorAll('.dpp-property-value a')]
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).
      toEqual([['Shop', 'https://a.example/'],
        ['https://b.example/care', 'https://b.example/care']])
  })
})
