/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Passport levels on the card.
 *
 * <dpp-walkup> is a band under the brandbar for a link to a
 * unit that has no passport of its own, answered in place
 * with the lot or model passport that covers it: it names
 * what was asked for and what is shown.
 *
 * <dpp-unit-passports> sits under the hero of a model or
 * lot passport and says its units carry passports of their
 * own, at the level the snapshot names.
 */

import { LightElement } from '@/reactive/element'
import { el } from '@/reactive/dom'
import { activeSnapshot } from '@/state'
import { config } from '@/config'
import { i18n } from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'
import {
  requestedPassport, isWalkUp, type PassportLevel,
} from '@/passport-level'

const LEVEL_NAME: Readonly<Record<PassportLevel, LabelKey>> = {
  model: 'passportLevel.model',
  lot: 'passportLevel.lot',
  item: 'passportLevel.item',
}

class DppWalkup extends LightElement {
  protected setup(): void {
    const path = window.location?.pathname ?? ''
    const asked = requestedPassport(config.requested ?? {}, path)
    if (!asked) return

    this.effect(() => {
      const served = activeSnapshot().level
      if (!served || !isWalkUp(asked.level, served)) {
        this.replaceChildren()
        return
      }
      const labels = i18n.labels
      const vars = {
        asked: t(labels, LEVEL_NAME[asked.level]),
        id: asked.id,
        served: t(labels, LEVEL_NAME[served]),
      }
      const text = t(labels, 'walkUp.body', vars)
      const band = el('p', 'walkup', text)
      band.setAttribute('role', 'status')
      this.replaceChildren(band)
    })
  }
}

class DppUnitPassports extends LightElement {
  protected setup(): void {
    this.effect(() => {
      const level = activeSnapshot().unitLevel
      if (!level) {
        this.replaceChildren()
        return
      }
      const labels = i18n.labels
      const name = t(labels, LEVEL_NAME[level])
      const text = t(labels, 'unitPassports.note', { level: name })
      this.replaceChildren(el('p', 'unit-passports', text))
    })
  }
}

customElements.define('dpp-walkup', DppWalkup)
customElements.define('dpp-unit-passports', DppUnitPassports)
