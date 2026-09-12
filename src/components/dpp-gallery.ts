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
import { tx, type SnapshotImage } from '@/types'
import { getPages } from '@/pagination'
import { OPEN_EVENT, type OpenLightboxDetail } from './dpp-lightbox'

class DppGallery extends LightElement {
  private current = signal(0)
  private lastKey = ''

  // Thumbnails already asked for, so paging back and forth
  // over the same pair does not re-request them.
  private warmed = new Set<string>()

  protected setup(): void {
    this.innerHTML = `
      <div class="gallery">
        <ul class="images">
          <li><img class="gallery-image" alt="" fetchpriority="high"/></li>
        </ul>
        <div class="navigation"></div>
      </div>
    `

    const wrap = this.querySelector('.gallery') as HTMLDivElement
    const img = this.querySelector('.gallery-image') as HTMLImageElement
    const nav = this.querySelector('.navigation') as HTMLDivElement

    // The hero is the page's largest paint and only becomes
    // known once the snapshot is in, late in the load; the
    // high priority keeps it ahead of the key and locale
    // requests that start at the same moment.

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
    applyRenditions(img, images[idx])
    markPending(wrap, img)
    this.warmNeighbours(images, idx)
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

  // A visitor who pages once almost always pages again, and
  // the next picture is a fresh request that only starts
  // when they ask for it. Fetch the neighbours while they
  // are looking at this one, at low priority so they queue
  // behind anything the page still needs, and not at all
  // for a visitor who has asked their browser to save data.
  private warmNeighbours(
    images: ReadonlyArray<SnapshotImage>, idx: number
  ): void {
    if (navigator.connection?.saveData) return
    for (const near of [idx - 1, idx + 1]) {
      const url = images[near]?.thumbnail
      if (!url || this.warmed.has(url)) continue
      this.warmed.add(url)
      const warm = new Image()
      warm.fetchPriority = 'low'
      warm.src = url
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

// Swapping `src` leaves the frame showing the old picture,
// or nothing, until the new bytes arrive, so on a slow link
// a page turn looks like it did not register. Say that the
// picture is on its way and let the stylesheet show it.
// Already-decoded bytes clear it in the same pass, so a
// warmed neighbour never flickers the state on.
function markPending(wrap: HTMLElement, img: HTMLImageElement): void {
  if (img.complete) {
    wrap.classList.remove('loading')
    return
  }
  wrap.classList.add('loading')
  const done = (): void => wrap.classList.remove('loading')
  img.addEventListener('load', done, { once: true })
  img.addEventListener('error', done, { once: true })
}

// What the hero image actually fills: a fixed column
// beside the product copy, and, once the card stacks, the
// viewport less the card's own 25px of padding either
// side. A publisher's frame only narrows that further, and
// over-declaring costs bytes where under-declaring would
// cost sharpness. Tracks .dpp-hero-image and .card-content
// in dpp.scss.
const HERO_SIZES = '(max-width: 600px) calc(100vw - 50px), 320px'

// Offer every rendition the publisher holds of this image,
// so the browser can spend bytes on the box it will fill
// and the density it renders at. An image carrying none is
// cleared rather than left alone: a srcset from the
// previously shown image would outrank the src just set.
function applyRenditions(
  img: HTMLImageElement, image: SnapshotImage
): void {
  const variants = image.variants
  if (!variants || variants.length === 0) {
    img.removeAttribute('srcset')
    img.removeAttribute('sizes')
    return
  }
  img.srcset = variants.map((v) => `${v.url} ${v.width}w`).join(', ')
  img.sizes = HERO_SIZES
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
