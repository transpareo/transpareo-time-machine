/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-downloads>, the files the passport pinned other than
 * those a property points at, after the accordions. A
 * property pointing at a file draws the same row in the
 * property list (buildDocumentRow).
 *
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
import { renderedProduct } from '@/state'
import { i18n, formatLongDate } from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'
import {
  txLang, type DocumentFile, type DppDocument, type LangText,
} from '@/types'
import { safeLinkHref } from '@/safe-url'

const DAY_MS = 86_400_000

const tr = (key: LabelKey): string => t(i18n.labels, key)

class DppDownloads extends LightElement {
  protected setup(): void {
    this.effect(() => {
      const downloads = renderedProduct().downloads ?? []
      const rows = downloads.map((d) => buildDocumentRow(titleOf(d), d))
      const heading = el('h2', 'dpp-section-title', tr('downloads.heading'))
      this.replaceChildren(...(rows.length ? [heading, ...rows] : []))
    })
  }
}

// The name the publisher gave the file, else its type, else
// the last segment of its address.
function titleOf(doc: DppDocument): LangText {
  if (doc.name) return txLang(doc.name, i18n.locale)
  if (doc.type) return [tr(`documentType.${doc.type}`)]
  return [doc.files[0].href.split('/').pop() ?? '']
}

export function buildDocumentRow(
  [title, lang]: LangText, doc: DppDocument,
): HTMLElement {
  const row = el('div', 'dpp-property-row dpp-document')
  const href = safeLinkHref(fileFor(doc, i18n.locale).href)
  const link = href ? el('a', 'dpp-ext-link', title, lang) : null
  if (link && href) {
    link.href = href
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.prepend(icon('download'))
  }
  row.append(link ?? el('span', undefined, title, lang))
  if (doc.type) {
    const type = tr(`documentType.${doc.type}`)
    row.append(el('span', 'dpp-document-type', type))
  }

  const details = buildDetails(doc)
  if (details.children.length) row.append(details)
  return row
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
