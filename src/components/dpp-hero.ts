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
import { txLang, type LangText } from '@/types'
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
          <h1 class="dpp-product-name" lang=${() => field('name')[1]}>
            ${() => field('name')[0]}
          </h1>
          <div class="dpp-meta">
            <span lang=${categoryLang}>${categoryText}</span>${metaText}
          </div>
          <div class="dpp-historical-tag" style=${() => historicalDisplay()}>
            ${() => t(i18n.labels, 'historicalView')}
          </div>
          <div class="dpp-product-rating-slot"></div>
          <div class="dpp-description" lang=${() => field('description')[1]}>
            ${() => field('description')[0]}
          </div>
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

// A localized product field: its text, and its language
// when the publisher left it untranslated. The template
// binds the two to the text and the `lang` of one element.
function field(key: 'name' | 'category' | 'description'): LangText {
  return txLang(renderedProduct()[key], i18n.locale)
}

function categoryText(): string {
  return field('category')[0]
}

function categoryLang(): string | undefined {
  return field('category')[1]
}

function gtinText(): string {
  const gtin = renderedProduct().gtin
  return gtin ? `GTIN\u00a0${gtin}` : ''
}

function weightText(): string {
  const p = renderedProduct()
  if (!p.weight) return ''
  const unit = p.weightUnit ?? 'g'
  return `${formatNumber(p.weight)}\u00a0${unit}`
}

// The line after the category, which sits in a span of its
// own to declare its language. Absent segments are dropped,
// so a product without a category, GTIN or weight never
// renders a dangling separator dot. NBSP inside a segment
// keeps line wraps at the separators only.
function metaText(): string {
  const rest = [gtinText(), weightText()].filter(Boolean).join(' · ')
  return rest && categoryText() ? ` · ${rest}` : rest
}

function imageDisplay(): string {
  return renderedProduct().images.length > 0 ? '' : 'display:none'
}

function historicalDisplay(): string {
  return isOnCurrent() ? 'display:none' : ''
}

customElements.define('dpp-hero', DppHero)
