/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-hero>, top of the live card. Product name,
 * primary photo, brand line, GTIN/weight meta, and the
 * historical-view tag when scrubbing.
 */

import { LightElement } from '@/reactive/element'
import { html } from '@/reactive/html'
import { renderedProduct, activeSnapshot, isOnCurrent } from '@/state'
import { i18n, formatNumber } from '@/i18n'
import { tx } from '@/types'
import { t } from '@/i18n/labels'
import { buildRatingRow } from '@/rating'
import './dpp-gallery'

class DppHero extends LightElement {
  protected setup(): void {
    const tpl = html`
      <div class="dpp-hero">
        <div class="dpp-hero-image" style=${() => imageDisplay()}>
          <dpp-gallery></dpp-gallery>
        </div>
        <div class="dpp-hero-info">
          <div class="dpp-passport-eyebrow">
            <span class="dpp-passport-label">
              ${() => t(i18n.labels, 'digitalProductPassport')}
            </span>
            <span class="dpp-passport-date">${passportDate}</span>
          </div>
          <div class="dpp-brand">${() => renderedProduct().brand}</div>
          <h1 class="dpp-product-name">${productName}</h1>
          <div class="dpp-meta">
            <span>${categoryText}</span>
            <span>${gtinText}</span>
            <span>${weightText}</span>
          </div>
          <div class="dpp-historical-tag" style=${() => historicalDisplay()}>
            ${() => t(i18n.labels, 'historicalView')}
          </div>
          <div class="dpp-product-rating-slot"></div>
          <div class="dpp-description">${descriptionText}</div>
        </div>
      </div>
    `
    tpl.mount(this, this.effect.bind(this))

    // The html template engine only handles string-typed
    // reactive slots, so the rating row is composed in a
    // dedicated effect that rebuilds whenever the active
    // product changes. Hidden entirely when the
    // snapshot does not carry a product-level rating.
    const slot = this.querySelector('.dpp-product-rating-slot')
    if (slot) {
      this.effect(() => {
        const r = renderedProduct().rating
        if (r) slot.replaceChildren(buildRatingRow(r))
        else slot.replaceChildren()
      })
    }
  }
}

function passportDate(): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: 'long', year: 'numeric',
  }
  const fmt = new Intl.DateTimeFormat(i18n.locale, opts)
  return fmt.format(new Date(activeSnapshot().publishedAt))
}

function productName(): string {
  return tx(renderedProduct().name, i18n.locale)
}

function categoryText(): string {
  const cat = renderedProduct().category
  return cat ? tx(cat, i18n.locale) : ''
}

function gtinText(): string {
  const gtin = renderedProduct().gtin
  return gtin ? `GTIN ${gtin}` : ''
}

function weightText(): string {
  const p = renderedProduct()
  if (!p.weight) return ''
  const unit = p.weightUnit ?? 'g'
  return `${formatNumber(p.weight)} ${unit}`
}

function descriptionText(): string {
  const desc = renderedProduct().description
  return desc ? tx(desc, i18n.locale) : ''
}

function imageDisplay(): string {
  return renderedProduct().images.length > 0 ? '' : 'display:none'
}

function historicalDisplay(): string {
  return isOnCurrent() ? 'display:none' : ''
}

customElements.define('dpp-hero', DppHero)
