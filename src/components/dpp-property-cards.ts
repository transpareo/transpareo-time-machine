/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-property-cards>, flat grid of label/value tiles
 * for scalar product attributes (article number, weight,
 * footprint figures, etc.) and for the files properties
 * point at. Filters the active version's presentation rows
 * to those with no namespace and renders one tile per row,
 * then a tile for the day the lot was made on a passport
 * frozen from a lot. Hidden when no tile applies.
 */

import { LightElement } from '@/reactive/element'
import { el, phrase } from '@/reactive/dom'
import { icon, iconForProperty } from '@/icons'
import { activeSnapshot, renderedPresentation } from '@/state'
import { servedRows } from '@/private-properties'
import { i18n, formatNumber, formatLongDate } from '@/i18n'
import { t } from '@/i18n/labels'
import {
  propertyIsKind, txLang, type LangText, type PropertyValue,
  type PropertyValueOf,
} from '@/types'
import {
  visiblePublicRows, isDocumentRow, isDocumentTile, type DocumentRow
} from '@/visible-properties'
import {
  buildDownloadJump, documentTypeLabel, jumpToDownload
} from '@/components/dpp-downloads'

type Scalar = PropertyValueOf<'scalar'>

class DppPropertyCards extends LightElement {
  protected setup(): void {
    const wrap = el('div', 'dpp-metrics')
    wrap.addEventListener('click', jumpToDownload)
    this.appendChild(wrap)

    this.effect(() => {
      // Scalar rows without a namespace render as
      // metric tiles, and so do the file properties
      // without one the page shows. Namespaced rows
      // (article numbers, supplier IDs, etc.) land in
      // the "additional product data" table inside
      // <dpp-properties> instead.
      const served = new Set(servedRows().map((r) => r.key))
      const files = new Set<PropertyValue>(
        visiblePublicRows(served).filter(isDocumentTile))
      const cards = renderedPresentation().flatMap((p) => {
        if (files.has(p) && isDocumentRow(p)) return buildDocumentCard(p)
        if (propertyIsKind('scalar')(p) && !p.namespace) return buildCard(p)
        return []
      })
      const lotDate = activeSnapshot().lotManufacturedOn
      if (lotDate) cards.push(buildLotCard(lotDate))
      wrap.style.display = cards.length ? '' : 'none'
      wrap.replaceChildren(...cards)
    })
  }
}

function buildCard(row: Scalar): HTMLElement {
  const v = row.value
  const [value, lang]: LangText = v.numeric != null
    ? [formatNumber(v.numeric)] : txLang(v.value, i18n.locale)
  const text = v.unit ? `${value} ${v.unit}` : value
  const label = phrase(txLang(row.name, i18n.locale))
  const id = iconForProperty(row.key)
  const card = buildTile(id ? icon(id) : null, label, text, lang)

  // Only a past version shows a row marked dynamic here; its
  // value is the reading sealed at publish.
  if (row.dynamic) {
    const note = t(i18n.labels, 'properties.atPublish')
    card.append(el('div', 'dpp-metric-note', note))
  }
  return card
}

// A property pointing at a file: the file's type, under a
// name led by the control that jumps to the file under
// Downloads, where another tile shows its icon.
function buildDocumentCard(row: DocumentRow): HTMLElement {
  const name = txLang(row.name, i18n.locale)
  const jump = buildDownloadJump(row.key, name[0])
  const type = documentTypeLabel(row.value.document)
  return buildTile(jump, phrase(name), type)
}

// The day the passport's lot was made, on every passport
// frozen from a lot. No property stands behind it, so its
// glyph is fixed instead of looked up in the icon map.
function buildLotCard(date: string): HTMLElement {
  const label = t(i18n.labels, 'lot.manufacturedOn')
  return buildTile(icon('calendar'), label, formatLongDate(date, i18n.locale))
}

// `lead` stands before the label: the property's icon, or
// a control in its place.
function buildTile(
  lead: Element | null, label: string | Node, value: string, lang?: string
): HTMLElement {
  const card = el('div', 'dpp-metric')
  const head = el('div', 'dpp-metric-label')
  if (lead) head.append(lead, ' ')
  head.append(label)
  card.append(head, el('div', 'dpp-metric-value', value, lang))
  return card
}

customElements.define('dpp-property-cards', DppPropertyCards)
