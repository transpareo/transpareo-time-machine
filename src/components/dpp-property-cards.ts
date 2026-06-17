/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-property-cards>, flat grid of label/value tiles
 * for scalar product attributes (article number, weight,
 * footprint figures, etc.). Filters the active version's
 * presentation rows to scalars with no namespace and
 * renders one tile per row. Hidden when the filtered
 * list is empty.
 */

import { LightElement } from '@/reactive/element'
import { el } from '@/reactive/dom'
import { icon, iconForProperty } from '@/icons'
import { renderedPresentation } from '@/state'
import { i18n, formatNumber } from '@/i18n'
import {
  propertyIsKind, tx, type PropertyValueOf,
} from '@/types'

type Scalar = PropertyValueOf<'scalar'>

class DppPropertyCards extends LightElement {
  protected setup(): void {
    const wrap = el('div', 'dpp-metrics')
    this.appendChild(wrap)

    this.effect(() => {
      // Scalar rows without a namespace render as
      // metric tiles. Namespaced scalars (article
      // numbers, supplier IDs, etc.) land in the
      // "additional product data" table inside
      // <dpp-properties> instead.
      const rows = renderedPresentation()
        .filter(propertyIsKind('scalar'))
        .filter((p) => !p.namespace)
      wrap.style.display = rows.length ? '' : 'none'
      wrap.replaceChildren(...rows.map(buildCard))
    })
  }
}

function buildCard(row: Scalar): HTMLElement {
  const card = el('div', 'dpp-metric')
  const v = row.value
  const value = v.numeric != null
    ? formatNumber(v.numeric) : tx(v.value, i18n.locale)
  const text = v.unit ? `${value} ${v.unit}` : value
  card.append(
    buildLabel(row),
    el('div', 'dpp-metric-value', text),
  )
  return card
}

function buildLabel(row: Scalar): HTMLElement {
  const label = el('div', 'dpp-metric-label')
  const iconId = iconForProperty(row.key)
  if (iconId) {
    label.appendChild(icon(iconId))
    label.append(' ')
  }
  label.append(tx(row.name, i18n.locale))
  return label
}

customElements.define('dpp-property-cards', DppPropertyCards)
