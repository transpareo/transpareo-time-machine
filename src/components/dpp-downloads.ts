/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-downloads>, every file the passport pinned, after the
 * accordions: its own downloads first, then the files the
 * page's properties point at, in the order the page shows
 * those properties. Such a property keeps its place on the
 * card, naming the file's type, with a control before its
 * name that jumps here (buildDownloadJump).
 *
 * Each row leads with a page showing the file's extension.
 * The row opens the file in the reader's language when the
 * publisher holds a version in it, else the file for every
 * language. Its type is a code named in the reader's
 * language; issuer and number are shown as the publisher
 * typed them. A document past its validity says so, by the
 * reader's clock, since the passport was signed long before
 * anyone reads it.
 */

import { LightElement } from '@/reactive/element'
import { el } from '@/reactive/dom'
import { icon } from '@/icons'
import { prefersReducedMotion } from '@/motion'
import { renderedProduct } from '@/state'
import { servedRows } from '@/private-properties'
import { i18n, formatLongDate } from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'
import {
  txLang, type DocumentFile, type DppDocument, type LangText,
} from '@/types'
import { safeLinkHref } from '@/safe-url'
import {
  visiblePublicRows, visiblePrivateRows, isDocumentRow
} from '@/visible-properties'

const DAY_MS = 86_400_000

const tr = (key: LabelKey): string => t(i18n.labels, key)

class DppDownloads extends LightElement {
  protected setup(): void {
    this.effect(() => {
      const pinned = (renderedProduct().downloads ?? [])
        .map((d) => buildDocumentRow(titleOf(d), d))
      const rows = [...pinned, ...propertyRows()]
      const heading = el('h2', 'dpp-section-title')
      heading.append(icon('download'), ' ', tr('downloads.heading'))
      this.replaceChildren(...(rows.length ? [heading, ...rows] : []))
    })
  }
}

// The files of the properties the page shows, each titled
// with its property's name and tagged with its key, so the
// property's jump control finds it.
function propertyRows(): HTMLElement[] {
  const served = servedRows()
  const keys = new Set(served.map((r) => r.key))
  const shown = [...visiblePublicRows(keys), ...visiblePrivateRows(served)]
  return shown.filter(isDocumentRow).map((r) => {
    const row = buildDocumentRow(txLang(r.name, i18n.locale), r.value.document)
    row.dataset.propertyKey = r.key
    return row
  })
}

// The name the publisher gave the file, else its type, else
// the last segment of its address.
function titleOf(doc: DppDocument): LangText {
  if (doc.name) return txLang(doc.name, i18n.locale)
  if (doc.type) return [documentTypeLabel(doc)]
  return [doc.files[0].href.split('/').pop() ?? '']
}

// The file's type in the reader's language; a file the
// publisher gave no type reads as a document.
export function documentTypeLabel(doc: DppDocument): string {
  return tr(`documentType.${doc.type ?? 'other'}`)
}

// The control before the name of a property pointing at a
// file. Its click is handled by jumpToDownload, delegated
// from the container the property renders in.
export function buildDownloadJump(
  key: string, name: string,
): HTMLButtonElement {
  const label = t(i18n.labels, 'downloads.jump', { name })
  const button = el('button', 'dpp-download-jump')
  button.type = 'button'
  button.title = label
  button.dataset.propertyKey = key
  button.setAttribute('aria-label', label)
  button.append(icon('download'))
  return button
}

// Scrolls the file's row into view and moves focus to its
// link, so the next key press opens the file.
export function jumpToDownload(event: Event): void {
  const target = event.target as Element
  const jump = target.closest<HTMLElement>('.dpp-download-jump')
  if (!jump) return

  const root = jump.getRootNode() as ParentNode
  const rows = root.querySelectorAll<HTMLElement>(
    'dpp-downloads [data-property-key]')
  const key = jump.dataset.propertyKey
  const row = [...rows].find((r) => r.dataset.propertyKey === key)
  if (!row) return

  const behavior = prefersReducedMotion() ? 'auto' : 'smooth'
  row.scrollIntoView({ block: 'center', behavior })
  row.querySelector('a')?.focus({ preventScroll: true })
}

function buildDocumentRow(
  [title, lang]: LangText, doc: DppDocument,
): HTMLElement {
  const row = el('div', 'dpp-property-row dpp-document')
  const href = safeLinkHref(fileFor(doc, i18n.locale).href)
  const link = href ? el('a', 'dpp-ext-link', title, lang) : null
  if (link && href) {
    link.href = href
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.prepend(buildFileIcon(href))
  }
  row.append(link ?? el('span', undefined, title, lang))
  if (doc.type) {
    row.append(el('span', 'dpp-document-type', documentTypeLabel(doc)))
  }

  const details = buildDetails(doc)
  if (details.children.length) row.append(details)
  return row
}

// A page with the file's extension laid over it. The
// stylesheet draws the extension from `data-ext`, so the
// link's text stays the file's title.
function buildFileIcon(href: string): HTMLElement {
  const symbol = el('span', 'dpp-file-icon')
  symbol.setAttribute('aria-hidden', 'true')
  const ext = extensionOf(href)
  if (ext) symbol.dataset.ext = ext
  symbol.append(icon('file'))
  return symbol
}

// The extension the file's address ends in, upper case, or
// null when its last segment names none.
function extensionOf(href: string): string | null {
  const name = href.split(/[?#]/)[0].split('/').pop() ?? ''
  const match = /\.([a-z0-9]{1,5})$/i.exec(name)
  return match ? match[1].toUpperCase() : null
}

// The version in the reader's language, else the file for
// every language, else the first one named.
function fileFor(doc: DppDocument, locale: string): DocumentFile {
  const inLocale = doc.files.find((f) =>
    f.languages?.some((l) => l.split('-')[0] === locale))
  return inLocale ?? doc.files.find((f) => !f.languages) ?? doc.files[0]
}

function buildDetails(doc: DppDocument): HTMLDListElement {
  const list = el('dl', 'dpp-document-details')
  const add = (key: LabelKey, value: string): HTMLElement => {
    const dd = el('dd', undefined, value)
    const pair = el('div')
    pair.append(el('dt', undefined, tr(key)), dd)
    list.append(pair)
    return dd
  }

  if (doc.issuer) add('document.issuer', doc.issuer)
  if (doc.number) add('document.number', doc.number)
  if (doc.validUntil) {
    const date = formatLongDate(doc.validUntil, i18n.locale)
    const dd = add('document.validUntil', date)
    if (hasExpired(doc.validUntil)) {
      const badge = el('span', 'dpp-document-expired', tr('document.expired'))
      dd.append(' ', badge)
    }
  }
  return list
}

// A document is valid through the whole of its last day. The
// date is a calendar date, read as UTC like formatLongDate
// shows it, so the badge and the date agree.
function hasExpired(validUntil: string): boolean {
  return Date.parse(validUntil) + DAY_MS <= Date.now()
}

customElements.define('dpp-downloads', DppDownloads)
