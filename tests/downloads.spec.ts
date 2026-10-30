// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The files a passport pinned: the Downloads section after
 * the accordions, and a property pointing at a file in the
 * property list. Both draw the same document row.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as host from '@/host'
import { locale } from '@/i18n'
import { fetchStateByVersion } from '@/private-properties'
import type { DppDocument, DppSnapshot, PropertyValue } from '@/types'
import '@/components/dpp-downloads'
import '@/components/dpp-properties'

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
    expect(heading?.textContent).toBe('Downloads')
    const links = section.querySelectorAll('.dpp-document a.dpp-ext-link')
    expect([...links].map((a) => a.textContent)).
      toEqual(['Care guide', 'Textile certificate'])
  })

  it('opens the file in a new tab beside a download icon', () => {
    show([guide])
    const link = mount('dpp-downloads').querySelector('a')!

    expect(link.getAttribute('href')).toBe(GUIDE)
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noopener noreferrer')
    expect(link.querySelector('svg.icon-download')).not.toBeNull()
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

  it('draws the document row under the property name', () => {
    show(undefined, [declaration])
    const list = mount('dpp-properties')

    const row = rowFor(list, CERT)!
    expect(row.querySelector('a')?.textContent).
      toBe('Declaration of conformity')
    expect(row.querySelector('.dpp-document-expired')).not.toBeNull()
  })

  it('keeps a link that pins no file a plain link', () => {
    const plain = { ...declaration, value: { type: 'link', href: CERT } }
    show(undefined, [plain as PropertyValue])
    const list = mount('dpp-properties')
    expect(list.querySelector('.dpp-document')).toBeNull()
    expect(list.querySelector('a svg')).toBeNull()
  })
})
