/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The files a fixture passport pins. The seed renders each
 * as a one-page PDF, serves it under its own SHA-256 the way
 * the platform serves a frozen copy, and signs a Link naming
 * it by that digest: on the product's downloads, or as the
 * value of the property pointing at it.
 */
import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { FixtureSchema } from '../scripts/seed/schema.ts'
import { seedDocuments } from '../scripts/seed/emit-artefacts.ts'
import { onePagePdf } from '../scripts/seed/pdf.ts'
import { documentOf } from '../src/property-classify'
import { DOCUMENT_TYPE_DATATYPE } from '../src/document-types'

function base(): Record<string, unknown> {
  return {
    schema_version: 1,
    id: 'demo-fixture',
    code: 'demo-1',
    status: 'in_use',
    published_at: '2026-01-01T00:00:00Z',
    verified: false,
    issuer: { name: 'A', did: 'did:web:a.example' },
    platform: { name: 'P', did: 'did:web:p.example' },
    available_locales: ['en', 'de'],
    documents: {
      guide: {
        name: { en: 'Care guide', de: 'Pflegeanleitung' },
        type: 'manual',
        files: [
          { text: 'Care guide' },
          { text: 'Pflegeanleitung', languages: ['de'] }
        ]
      },
      certificate: {
        name: 'Textile certificate',
        type: 'certificate',
        issuer: 'Atlantic Textile Testing',
        number: 'ATT-2023-41877',
        valid_from: '2023-07-01',
        valid_until: '2025-06-30',
        files: [{ text: 'Textile certificate ATT-2023-41877' }]
      }
    },
    product: {
      name: 'Demo',
      brand: 'A',
      description: 'D',
      compositions: [{
        key: 'material',
        title: 'Material',
        entries: [{ name: 'Clay', percent: 100, color: '#B4653F' }]
      }],
      metrics: [
        { key: 'certificate', label: 'Certificate', document: 'certificate' }
      ],
      lists: [],
      accordions: [],
      downloads: ['guide'],
      manufacturer: {
        name: 'A', street: 'S 1', city: 'C', country: 'Portugal'
      }
    },
    snapshots: [{
      version: 1,
      published_at: '2026-01-01T00:00:00Z',
      status: 'in_use',
      composition: [{ name: 'Clay', percent: 100, color: '#B4653F' }]
    }],
    events: []
  }
}

function issuesOf(doc: Record<string, unknown>): string[] {
  const r = FixtureSchema.safeParse(doc)
  if (r.success) return []
  return r.error.issues.map((i) => i.path.join('.'))
}

function sri(bytes: Buffer): string {
  return `sha256-${createHash('sha256').update(bytes).digest('base64')}`
}

describe('the fixture schema for documents', () => {
  it('accepts documents named by a download and a property', () => {
    expect(issuesOf(base())).toEqual([])
  })

  it('refuses a download naming no document', () => {
    const doc = base()
    const product = doc.product as Record<string, unknown>
    product.downloads = ['manual']
    expect(issuesOf(doc)).toEqual(['product.downloads.0'])
  })

  it('refuses a property pointing at no document', () => {
    const doc = base()
    const product = doc.product as Record<string, unknown>
    product.metrics = [{ key: 'doc', label: 'Doc', document: 'missing' }]
    expect(issuesOf(doc)).toEqual(['product.metrics.0.document'])
  })

  it('refuses a property carrying a value and a document', () => {
    const doc = base()
    const product = doc.product as Record<string, unknown>
    product.metrics = [
      { key: 'doc', label: 'Doc', value: 'x', document: 'guide' }
    ]
    expect(issuesOf(doc)).toEqual(['product.metrics.0'])
  })

  it('refuses a type outside the code list', () => {
    const doc = base()
    const documents = doc.documents as Record<string, Record<string, unknown>>
    documents.guide.type = 'leaflet'
    expect(issuesOf(doc)).toEqual(['documents.guide.type'])
  })

  // Helvetica in a bare PDF reads one byte per character.
  it('refuses file text outside Latin-1', () => {
    const doc = base()
    const documents = doc.documents as Record<string, Record<string, unknown>>
    documents.guide.files = [{ text: 'Руководство' }]
    expect(issuesOf(doc)).toEqual(['documents.guide.files.0.text'])
  })
})

describe('onePagePdf', () => {
  const pdf = onePagePdf('Prüfbericht (Probe 2)').toString('latin1')

  it('is a PDF from its header to its end marker', () => {
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true)
    expect(pdf.endsWith('%%EOF\n')).toBe(true)
  })

  it('points every cross-reference at its object', () => {
    const table = pdf.slice(pdf.indexOf('xref\n'))
    const offsets = [...table.matchAll(/^(\d{10}) 00000 n $/gm)]
      .map((m) => Number(m[1]))
    expect(offsets).toHaveLength(5)
    offsets.forEach((at, i) => {
      expect(pdf.slice(at).startsWith(`${i + 1} 0 obj\n`)).toBe(true)
    })
    const start = Number(pdf.match(/startxref\n(\d+)\n/)![1])
    expect(pdf.slice(start).startsWith('xref\n')).toBe(true)
  })

  it('escapes the characters a PDF string reserves', () => {
    expect(pdf).toContain('(Pr\xfcfbericht \\(Probe 2\\)) Tj')
  })
})

describe('seedDocuments', () => {
  const fixture = FixtureSchema.parse(base())
  const seeded = seedDocuments(fixture)

  it('serves each file under its own digest', () => {
    expect(seeded.files).toHaveLength(3)
    for (const file of seeded.files) {
      const hex = createHash('sha256').update(file.bytes).digest('hex')
      expect(file.path).toBe(`demo-fixture/files/${hex}.pdf`)
    }
  })

  it('names the file for every language and its versions', () => {
    const [general, german] = seeded.files
    const link = seeded.links.guide
    expect(link).toMatchObject({
      '@type': 'Link',
      href: `/${general.path}`,
      mediaType: 'application/pdf',
      fileDigest: sri(general.bytes),
      documentType: { '@value': 'manual', '@type': DOCUMENT_TYPE_DATATYPE },
      fileVersions: [{
        '@type': 'Link',
        href: `/${german.path}`,
        mediaType: 'application/pdf',
        fileDigest: sri(german.bytes),
        fileLanguages: ['de']
      }]
    })
    expect(link).not.toHaveProperty('fileLanguages')
  })

  it('carries the details on the wire the platform signs', () => {
    expect(seeded.links.certificate).toMatchObject({
      name: 'Textile certificate',
      documentIssuer: 'Atlantic Textile Testing',
      documentNumber: 'ATT-2023-41877',
      documentValidFrom: '2023-07-01',
      documentValidUntil: '2025-06-30'
    })
  })

  it('reads back as the document the renderer shows', () => {
    const doc = documentOf(seeded.links.guide)
    expect(doc).toMatchObject({
      name: { en: 'Care guide', de: 'Pflegeanleitung' },
      type: 'manual'
    })
    expect(doc?.files.map((f) => f.languages)).toEqual([undefined, ['de']])
  })
})
