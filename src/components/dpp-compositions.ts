/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-compositions> mounts one <dpp-composition-donut
 * data-key="..."> per composition row: the active version's
 * rows the `?show=` gate passes, in declaration order, then
 * those the view a signed-in reader is served adds
 * (private-properties.ts panelRows). Each donut child looks
 * its own row up by key in the same list. Adding a new
 * composition row to a fixture surfaces a new donut
 * automatically.
 */

import { LightElement } from '@/reactive/element'
import { panelRows } from '@/private-properties'

class DppCompositions extends LightElement {
  protected setup(): void {
    this.effect(() => {
      const seen = new Set<string>()
      const children: HTMLElement[] = []
      for (const row of panelRows('composition')) {
        if (seen.has(row.key)) continue
        seen.add(row.key)
        const el = document.createElement('dpp-composition-donut')
        el.dataset.key = row.key
        children.push(el)
      }
      this.replaceChildren(...children)
    })
  }
}

customElements.define('dpp-compositions', DppCompositions)
