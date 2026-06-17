/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-gallery>, image carousel for the live card.
 * Reads the active snapshot's image list and renders the
 * currently-selected image with a `< 1 2 3 >` pagination
 * strip. Click an image to open the lightbox (it lives
 * elsewhere; we just dispatch a `dpp:open-lightbox`
 * CustomEvent that the lightbox listens for at the
 * document level).
 */

import { LightElement } from '@/reactive/element'
import { signal } from '@/reactive/signals'
import { el } from '@/reactive/dom'
import { icon } from '@/icons'
import { renderedProduct } from '@/state'
import { i18n } from '@/i18n'
import { t } from '@/i18n/labels'
import { tx } from '@/types'
import { getPages } from '@/pagination'
import { OPEN_EVENT, type OpenLightboxDetail } from './dpp-lightbox'

class DppGallery extends LightElement {
  private current = signal(0)
  private lastKey = ''

  protected setup(): void {
    this.innerHTML = `
      <div class="gallery">
        <ul class="images">
          <li><img class="gallery-image" alt=""/></li>
        </ul>
        <div class="navigation"></div>
      </div>
    `

    const wrap = this.querySelector('.gallery') as HTMLDivElement
    const img = this.querySelector('.gallery-image') as HTMLImageElement
    const nav = this.querySelector('.navigation') as HTMLDivElement

    // The image is the lightbox trigger, so it must be
    // keyboard-operable, not click-only.
    img.setAttribute('role', 'button')
    img.tabIndex = 0
    img.addEventListener('click', () => this.openLightbox())
    img.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.openLightbox()
      }
    })
    nav.addEventListener('click', (e) => this.onNavActivate(e.target, e))
    nav.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      this.onNavActivate(e.target, e)
    })

    this.effect(() => this.sync(wrap, img, nav))
  }

  private sync(
    wrap: HTMLElement, img: HTMLImageElement, nav: HTMLElement,
  ): void {
    const product = renderedProduct()
    const images = product.images
    const total = images.length

    const key = images.map((i) => i.large).join('|')
    if (key !== this.lastKey) {
      this.lastKey = key
      this.current.set(0)
    }

    if (total === 0) {
      wrap.style.display = 'none'
      return
    }
    wrap.style.display = ''

    const idx = Math.min(this.current(), total - 1)
    const alt = tx(product.name, i18n.locale)
    img.src = images[idx].thumbnail
    img.alt = alt
    img.title = alt
    img.setAttribute('aria-label', t(i18n.labels, 'gallery.openFull'))

    if (total > 1) {
      nav.style.display = ''
      nav.replaceChildren(navFragment(idx, total))
    } else {
      nav.style.display = 'none'
    }
  }

  private onNavActivate(target: EventTarget | null, e: Event): void {
    e.stopPropagation()

    // Walk up to the nearest pagination button: prev/next
    // host a `.glyph` child so the event may land on the
    // inner span; numbered pages are leaf spans.
    const btn = (target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-action], [data-page]',
    )
    if (!btn) return
    const action = btn.dataset.action
    const page = btn.dataset.page
    const total = renderedProduct().images.length

    if (action === 'prev' && this.current.peek() > 0) {
      this.current.update((n) => n - 1)
    } else if (action === 'next' && this.current.peek() < total - 1) {
      this.current.update((n) => n + 1)
    } else if (page) {
      this.current.set(parseInt(page, 10) - 1)
    }
  }

  private openLightbox(): void {
    const product = renderedProduct()
    const images = product.images
    if (!images.length) return

    const detail: OpenLightboxDetail = {
      images,
      idx: this.current.peek(),
      alt: tx(product.name, i18n.locale),
    }
    this.dispatchEvent(new CustomEvent(OPEN_EVENT, {
      detail, bubbles: true, composed: true,
    }))
  }
}

// Pure builder for the `< 1 2 … N >` pagination strip.
// Used here and re-exported so <dpp-lightbox> reuses the
// exact same DOM and class names, different colours
// come from CSS scoped to the lightbox host. Returns a
// DocumentFragment rather than an HTML string so the
// pattern is safe-by-default against XSS regressions
// (a future contributor adding a localised string or
// user-provided label can't accidentally introduce a
// rendering surface that interprets the value as HTML).
export function navFragment(
  currentIdx: number, total: number,
): DocumentFragment {
  const frag = document.createDocumentFragment()
  if (total <= 1) return frag
  const labels = i18n.labels

  const atStart = currentIdx === 0
  const prev = el('span', `prev btn${atStart ? ' inactive' : ''}`)
  prev.dataset.action = 'prev'
  setControlA11y(prev, t(labels, 'gallery.previous'), atStart)
  prev.appendChild(icon('chevron-down'))
  frag.appendChild(prev)

  for (const page of getPages(currentIdx + 1, total)) {
    if (page === '...') {
      frag.appendChild(el('span', 'ellipsis', '…'))
      continue
    }
    const isCurrent = page === currentIdx + 1
    const btn = el('span', isCurrent ? 'btn current' : 'btn', String(page))
    btn.dataset.page = String(page)
    btn.setAttribute('role', 'button')
    btn.tabIndex = 0
    if (isCurrent) btn.setAttribute('aria-current', 'true')
    frag.appendChild(btn)
  }

  const atEnd = currentIdx >= total - 1
  const next = el('span', `next btn${atEnd ? ' inactive' : ''}`)
  next.dataset.action = 'next'
  setControlA11y(next, t(labels, 'gallery.next'), atEnd)
  next.appendChild(icon('chevron-down'))
  frag.appendChild(next)

  return frag
}

// Make a prev/next chevron operable by keyboard: a labelled
// button role, focusable when active, skipped and marked
// disabled to assistive tech when it can't advance.
function setControlA11y(
  span: HTMLElement, label: string, disabled: boolean,
): void {
  span.setAttribute('role', 'button')
  span.setAttribute('aria-label', label)
  span.tabIndex = disabled ? -1 : 0
  if (disabled) span.setAttribute('aria-disabled', 'true')
}

customElements.define('dpp-gallery', DppGallery)
