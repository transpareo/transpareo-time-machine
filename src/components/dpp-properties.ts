/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-properties>, the flat property list driven by
 * the snapshot's top-level `properties` collection plus
 * the rows a signed-in reader's view serves, plus the
 * passport's live values. Layout is three stacked
 * sections:
 *
 *   1. Public list - category-1 (always-visible) and
 *      category-2 (on-demand) rows from snapshot
 *      .properties. An on-demand row the public bytes
 *      carry renders only when the URL's `?show=` token
 *      list unlocks its namespace, and only while the
 *      reader's view serves no row of its key. A file
 *      property without a namespace stands among the
 *      tiles instead (dpp-property-cards).
 *   2. "Current state" - the rows the snapshot marks
 *      dynamic, each with its reading from the dynamic-data
 *      document and the time that was written. They belong
 *      to today, so they show on the current version only.
 *      An on-demand row shows once a `?show=` token unlocks
 *      its namespace, and only while the reader's view
 *      serves no row of its key, as in the public list. A
 *      reading shows once its document's signature has
 *      cleared (see actions.liveDataIsShowable); until then,
 *      or without one, the property shows the reading its
 *      snapshot sealed at publish.
 *   3. "Additional product data" - the legitimate-
 *      interest and on-demand rows that arrived as
 *      `{ status: 'ok', rows }` from the manifest's
 *      `privateProperties.url` endpoint, shown as served,
 *      with no `?show=` token. An on-demand row the public
 *      list or "Current state" carries as well shows here
 *      alone, unless the fold-out panels show it: either
 *      side may sort one short value as a long text
 *      (bridgeLongTextGroups).
 *
 * A property pointing at a file names its type and jumps to
 * the file, which the Downloads section lists with every
 * other file the passport pinned.
 *
 * The sign-in and retry prompts for private rows live in
 * <dpp-private-signin>. The element is hidden entirely
 * when no section has a row, so a passport without
 * properties gets no empty section.
 */

import { LightElement } from '@/reactive/element'
import { el, phrase } from '@/reactive/dom'
import {
  activeSnapshot, isOnCurrent, dynamicDataProofState
} from '@/state'
import { dynamicData, dynamicDataPending, composeLiveRows } from '@/host'
import { liveDataIsShowable } from '@/actions'
import { i18n, formatNumber, formatDateTime } from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'
import { txLang, propertyIsKind, type LangText, type LiveRow } from '@/types'
import { isShown } from '@/show-filter'
import { safeLinkHref } from '@/safe-url'
import {
  buildDownloadJump, documentTypeLabel, jumpToDownload
} from '@/components/dpp-downloads'
import { servedRows } from '@/private-properties'
import {
  visiblePublicRows, visiblePrivateRows, isDocumentRow, isDocumentTile,
  type DetailRow, type DocumentRow, type LinkRow, type ScalarRow
} from '@/visible-properties'

// Short alias for the active-locale label lookup, used by
// the section headings and the at-publish note below.
const tr = (key: LabelKey): string => t(i18n.labels, key)

class DppProperties extends LightElement {
  protected setup(): void {
    const wrap = el('div', 'dpp-properties')
    wrap.addEventListener('click', jumpToDownload)
    this.appendChild(wrap)

    this.effect(() => {
      const served = servedRows()
      const servedKeys = new Set(served.map((r) => r.key))
      const privateRows = visiblePrivateRows(served)
      const publicRows = visiblePublicRows(servedKeys)
        .filter((r) => !isDocumentTile(r))

      const children: HTMLElement[] = publicRows.map(buildRow)
      children.push(...buildLiveSection(servedKeys))
      if (privateRows.length > 0) {
        children.push(buildHeading(tr('properties.additionalHeading')))
        for (const r of privateRows) children.push(buildRow(r))
      }

      const hasContent = children.length > 0
      wrap.style.display = hasContent ? '' : 'none'
      wrap.replaceChildren(...children)
    })
  }
}

// The live section: heading, when the readings were
// written, then one row per live property. Held while the
// document is in flight or being checked. A property with
// no verified reading shows the one sealed at publish.
// `served` holds the keys of the rows the reader's view
// serves.
function buildLiveSection(served: ReadonlySet<string>): HTMLElement[] {
  if (!isOnCurrent()) return []
  const doc = dynamicData()
  const state = dynamicDataProofState()
  if (dynamicDataPending() || (doc && state === 'pending')) return []

  // The document is the publisher's to write, and a
  // malformed one must cost the live section only.
  const verified = doc && liveDataIsShowable(state) ? doc : null
  const values = Array.isArray(verified?.values) ? verified.values : null

  // A row the `?show=` gate hides, or an on-demand one the
  // reader's view serves as well (it shows with the served
  // rows, as in the public list), takes any reading of its
  // key along, so none paints labelled by its propertyID.
  const props = activeSnapshot().properties
  const dropped = props
    .filter((r) => !isShown(r) || (r.onDemand && served.has(r.key)))
  const shut = new Set(dropped.map((r) => r.key))
  const rows = composeLiveRows(props, values)
    .filter((r) => !shut.has(r.key))
  if (rows.length === 0) return []

  const out = [buildHeading(tr('properties.liveHeading'))]
  const time = verified && formatDateTime(verified.updatedAt, i18n.locale)
  if (time) {
    const text = t(i18n.labels, 'properties.liveUpdated', { time })
    out.push(el('p', 'dpp-properties-updated', text))
  }
  return [...out, ...rows.map(buildLiveRow)]
}

function buildLiveRow(row: LiveRow): HTMLElement {
  const label = txLang(row.name, i18n.locale)
  return buildPair(label, formatValue(row.value), !row.live)
}

// A row marked dynamic outside the live block is a past
// version's: its value is the reading sealed at publish.
function buildRow(row: DetailRow): HTMLElement {
  if (isDocumentRow(row)) return buildDocumentPair(row)
  if (propertyIsKind('link')(row)) return buildLinkRow(row)
  const label = txLang(row.name, i18n.locale)
  return buildPair(label, formatValue(row.value), row.dynamic === true)
}

// A property pointing at a file names the file's type here,
// its name led by the control that jumps to the file, which
// Downloads lists.
function buildDocumentPair(row: DocumentRow): HTMLElement {
  const [label, lang] = txLang(row.name, i18n.locale)
  const wrap = el('div', 'dpp-property-row')
  const head = el('div', 'dpp-property-label', label, lang)
  head.prepend(buildDownloadJump(row.key, label), ' ')
  const type = documentTypeLabel(row.value.document)
  wrap.append(head, el('div', 'dpp-property-value', type))
  return wrap
}

// A web link: its name opens it in a new tab, at the row's
// own size. A URL with a scheme that could run script stays
// inert text.
function buildLinkRow(row: LinkRow): HTMLElement {
  const [label, lang] = txLang(row.name, i18n.locale)
  const href = safeLinkHref(row.value.href)
  const wrap = el('div', 'dpp-property-row', undefined, lang)
  if (!href) {
    wrap.append(label)
    return wrap
  }

  const a = el('a', 'dpp-ext-link', label)
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  wrap.append(a)
  return wrap
}

function formatValue(v: ScalarRow['value']): LangText {
  const [resolved, lang]: LangText = v.numeric != null
    ? [formatNumber(v.numeric)] : txLang(v.value, i18n.locale)
  return [v.unit ? `${resolved} ${v.unit}` : resolved, lang]
}

// A label and its value; a reading sealed at publish says
// so beneath the value, in the reader's language.
function buildPair(
  [label, lang]: LangText, value: LangText, atPublish: boolean,
): HTMLElement {
  const wrap = el('div', 'dpp-property-row')
  const cell = el('div', 'dpp-property-value')
  cell.append(phrase(value))
  if (atPublish) {
    cell.append(el('span', 'dpp-property-note', tr('properties.atPublish')))
  }
  wrap.append(el('div', 'dpp-property-label', label, lang), cell)
  return wrap
}

function buildHeading(text: string): HTMLElement {
  return el('h3', 'dpp-properties-heading', text)
}

customElements.define('dpp-properties', DppProperties)
