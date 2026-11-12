/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-downloads>, the files a passport pinned, after the
 * accordions, under one title. Each property naming a file
 * gets a group of its own, headed by its name, in the order
 * the page shows its properties; the passport's own documents
 * come last, in a group without a heading. A property naming
 * a file shows nowhere else on the card.
 *
 * A group lists the property's entries in the publisher's
 * order: a file with its details, a web address as a link. A
 * file row leads with a page showing the file's extension and
 * opens the file in the reader's language when the publisher
 * holds a version in it, else the file for every language. Its
 * type is a code named in the reader's language; issuer and
 * number are shown as the publisher typed them, the validity
 * as a date in the reader's language.
 */

import { LightElement } from '@/reactive/element'
import { el } from '@/reactive/dom'
import { icon, iconForProperty } from '@/icons'
import { renderedProduct } from '@/state'
import { i18n, formatLongDate } from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'
import {
  txLang, type DocumentFile, type DppDocument, type LangText,
  type LinkEntry,
} from '@/types'
import { safeLinkHref } from '@/safe-url'
import { visibleFileRows, type LinkRow } from '@/visible-properties'

const tr = (key: LabelKey): string => t(i18n.labels, key)

class DppDownloads extends LightElement {
  protected setup(): void {
    this.effect(() => {
      const groups = visibleFileRows().map(buildPropertyGroup)
      const own = renderedProduct().downloads ?? []
      if (own.length) groups.push(buildGroup(own.map(buildDocumentRow)))
      if (!groups.length) {
        this.replaceChildren()
        return
      }

      const title = el('h2', 'dpp-section-title')
      title.append(icon('download'), ' ', tr('downloads.heading'))
      this.replaceChildren(title, ...groups)
    })
  }
}

// A property naming files: its name, with its icon when the
// icon map has one, over its entries.
function buildPropertyGroup(row: LinkRow): HTMLElement {
  const [name, lang] = txLang(row.name, i18n.locale)
  const heading = el('h3', 'dpp-file-heading', name, lang)
  const id = iconForProperty(row.key)
  if (id) heading.prepend(icon(id), ' ')
  return buildGroup([heading, ...row.value.entries.map(buildEntryRow)])
}

function buildGroup(children: ReadonlyArray<HTMLElement>): HTMLElement {
  const group = el('section', 'dpp-file-section')
  group.append(...children)
  return group
}

function buildEntryRow(entry: LinkEntry): HTMLElement {
  if (entry.document) return buildDocumentRow(entry.document)
  const row = el('div', 'dpp-property-row')
  row.append(buildWebEntry(entry))
  return row
}

// A web address of a link field, titled with the name it
// carries, else the address itself.
export function buildWebEntry(entry: LinkEntry): HTMLElement {
  const text: LangText = entry.name
    ? txLang(entry.name, i18n.locale) : [entry.href]
  return buildWebLink(entry.href, text)
}

// A link opening in a new tab. An address with a scheme that
// could run script stays inert text.
export function buildWebLink(
  href: string, [text, lang]: LangText,
): HTMLElement {
  const safe = safeLinkHref(href)
  if (!safe) return el('span', undefined, text, lang)
  const link = el('a', 'dpp-ext-link', text, lang)
  link.href = safe
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  return link
}

// The name the publisher gave the file, else its type, else
// the last segment of its address.
function titleOf(doc: DppDocument): LangText {
  if (doc.name) return txLang(doc.name, i18n.locale)
  if (doc.type) return [documentTypeLabel(doc)]
  return [doc.files[0].href.split('/').pop() ?? '']
}

// The file's type in the reader's language.
function documentTypeLabel(doc: DppDocument): string {
  return tr(`documentType.${doc.type ?? 'other'}`)
}

function buildDocumentRow(doc: DppDocument): HTMLElement {
  const row = el('div', 'dpp-property-row dpp-document')
  const href = fileFor(doc, i18n.locale).href
  const link = buildWebLink(href, titleOf(doc))
  if (link instanceof HTMLAnchorElement) link.prepend(buildFileIcon(href))
  row.append(link)
  if (doc.type) {
    row.append(el('span', 'dpp-document-type', documentTypeLabel(doc)))
  }

  const details = buildDetails(doc)
  if (details.children.length) row.append(details)
  return row
}

// A page with the file's extension laid over it. The
// stylesheet draws the extension from `data-ext`, or from its
// two halves in two rows when it runs past three letters, so
// the link's text stays the file's title.
function buildFileIcon(href: string): HTMLElement {
  const symbol = el('span', 'dpp-file-icon')
  symbol.setAttribute('aria-hidden', 'true')
  symbol.append(icon('file'))
  const ext = extensionOf(href)
  if (!ext) return symbol

  symbol.dataset.ext = ext
  if (ext.length > 3) {
    symbol.classList.add('long')
    symbol.dataset.extHead = ext.slice(0, 2)
    symbol.dataset.extTail = ext.slice(2)
  }
  return symbol
}

// The three-letter form a reader knows the common four-letter
// types by.
const SHORT_EXTENSIONS: Readonly<Record<string, string>> = {
  DOCX: 'DOC', XLSX: 'XLS', PPTX: 'PPT', JPEG: 'JPG', TIFF: 'TIF'
}

// The extension the file's address ends in, upper case and in
// its three-letter form where it has a common one, or null
// when the address's last segment names none.
function extensionOf(href: string): string | null {
  const name = href.split(/[?#]/)[0].split('/').pop() ?? ''
  const match = /\.([a-z0-9]{1,5})$/i.exec(name)
  if (!match) return null
  const ext = match[1].toUpperCase()
  return SHORT_EXTENSIONS[ext] ?? ext
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
  const add = (key: LabelKey, value: string): void => {
    const pair = el('div')
    pair.append(el('dt', undefined, tr(key)), el('dd', undefined, value))
    list.append(pair)
  }

  if (doc.issuer) add('document.issuer', doc.issuer)
  if (doc.number) add('document.number', doc.number)
  if (doc.validUntil) {
    add('document.validUntil', formatLongDate(doc.validUntil, i18n.locale))
  }
  return list
}

customElements.define('dpp-downloads', DppDownloads)
