/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-manufacturer>, single-line address strip with a
 * building icon, sourced from the rendered product's
 * manufacturer fields. The country arrives as an ISO
 * 3166-1 code whenever the wire carries no spelled-out
 * name, so it is resolved through tx() like every other
 * localized field and re-renders on a locale switch.
 */

import { LightElement } from '@/reactive/element'
import { el } from '@/reactive/dom'
import { icon } from '@/icons'
import { renderedProduct } from '@/state'
import { i18n } from '@/i18n'
import { tx } from '@/types'

class DppManufacturer extends LightElement {
  protected setup(): void {
    const wrap = el('div', 'dpp-manufacturer')
    this.appendChild(wrap)

    this.effect(() => {
      const m = renderedProduct().manufacturer
      const fields = [m.name, m.street, m.city, tx(m.country, i18n.locale)]
      const parts = fields.filter(Boolean)
      wrap.style.display = parts.length ? '' : 'none'

      const spans = parts.map((p) => el('span', undefined, String(p)))
      wrap.replaceChildren(icon('building'), ...spans)
    })
  }
}

customElements.define('dpp-manufacturer', DppManufacturer)
