/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-badge-lists>, boxed lists of short string values
 * (intended use, available sizes, certifications, etc.).
 * One card per list, each with an icon-titled header and
 * a flat <ul>.
 */

import { LightElement } from '@/reactive/element'
import { el } from '@/reactive/dom'
import { icon, iconForProperty } from '@/icons'
import { renderedPresentation } from '@/state'
import { i18n } from '@/i18n'
import {
  propertyIsKind, tx, type PropertyValueOf,
} from '@/types'

type List = PropertyValueOf<'list'>

class DppBadgeLists extends LightElement {
  protected setup(): void {
    this.effect(() => {
      const rows = renderedPresentation().filter(propertyIsKind('list'))
      this.replaceChildren(...rows.map(buildCard))
    })
  }
}

function buildCard(row: List): HTMLElement {
  const card = el('div', 'dpp-list-card')
  const ul = el('ul', 'dpp-list')
  for (const v of row.value.items) {
    const text = tx(v, i18n.locale)
    ul.appendChild(el('li', undefined, text))
  }
  card.append(buildTitle(row), ul)
  return card
}

function buildTitle(row: List): HTMLElement {
  const title = el('h2', 'dpp-section-title')
  const iconId = iconForProperty(row.key)
  if (iconId) {
    title.appendChild(icon(iconId))
    title.append(' ')
  }
  title.append(tx(row.name, i18n.locale))
  return title
}

customElements.define('dpp-badge-lists', DppBadgeLists)
