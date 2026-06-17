/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-compositions> filters the active version's
 * flat presentation list to rows with value.type
 * 'composition' and mounts one <dpp-composition-donut
 * data-key="..."> per row, in declaration order. Each
 * donut child looks its own row up by key. Adding a new
 * composition row to a fixture surfaces a new donut
 * automatically.
 */

import { LightElement } from '@/reactive/element'
import { renderedPresentation } from '@/state'
import { propertyIsKind } from '@/types'

class DppCompositions extends LightElement {
  protected setup(): void {
    this.effect(() => {
      const rows = renderedPresentation().filter(
        propertyIsKind('composition'),
      )
      const seen = new Set<string>()
      const children: HTMLElement[] = []
      for (const row of rows) {
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
