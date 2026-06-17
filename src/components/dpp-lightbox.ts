/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-lightbox>, fullscreen image viewer. Reuses the
 * gallery's `< 1 2 3 >` pagination strip, re-skinned for
 * the dark backdrop. Always mounted as a sibling of the
 * card deck; hidden by default, revealed when the
 * `lightboxState` signal is non-null.
 *
 * Components don't reach for this element directly,
 * they dispatch a `dpp:open-lightbox` CustomEvent
 * (bubbles + composed: true so it crosses shadow
 * boundaries). The lightbox listens at the document
 * level and updates its state signal.
 */

import { LightElement } from '@/reactive/element'
import { signal } from '@/reactive/signals'
import { bindModalChrome } from '@/reactive/modal'
import { i18n } from '@/i18n'
import { t } from '@/i18n/labels'
import { navFragment } from './dpp-gallery'
import type { SnapshotImage } from '@/types'
import { WHEEL_AXIS_LOCK_PX } from '@/gestures'

export interface OpenLightboxDetail {
  images: ReadonlyArray<SnapshotImage>
  idx: number
  alt: string
}

export const OPEN_EVENT = 'dpp:open-lightbox'

const lightboxState = signal<OpenLightboxDetail | null>(null)

const SWIPE_THRESHOLD = 40
const WHEEL_THRESHOLD = 60
const WHEEL_RESET_MS = 110

class DppLightbox extends LightElement {
  private index = 0
  private images: ReadonlyArray<SnapshotImage> = []
  private alt = ''

  private wheelAccum = 0
  private wheelLatched = false
  private wheelResetTimer = 0

  private touchStartX = 0
  private touchStartY = 0
  private touchAxis: 'x' | 'y' | null = null
  private hostGesturesBound = false

  protected setup(): void {
    this.setAttribute('aria-label', t(i18n.labels, 'lightbox.title'))
    this.bindOpenEvent()
    this.bindArrowKeys()

    // Touch + wheel listen on the host, which persists
    // across opens AND across disconnect/reconnect (setup
    // re-runs on every reconnect but the node keeps its
    // listeners), so bind them exactly once.
    if (!this.hostGesturesBound) {
      this.hostGesturesBound = true
      this.bindTouch()
      this.bindWheel()
    }

    bindModalChrome(this, this.effect.bind(this), {
      isOpen: () => lightboxState() != null,
      onClose: close,
    })

    this.effect(() => this.render())
  }

  private bindOpenEvent(): void {
    const listener = (e: Event): void => {
      const detail = (e as CustomEvent<OpenLightboxDetail>).detail
      if (detail) lightboxState.set(detail)
    }
    document.addEventListener(OPEN_EVENT, listener)
    this.effect(() => () => document.removeEventListener(OPEN_EVENT, listener))
  }

  private bindArrowKeys(): void {
    const onKey = (e: KeyboardEvent): void => {
      if (lightboxState() == null) return
      if (e.key === 'ArrowLeft') this.go(this.index - 1)
      else if (e.key === 'ArrowRight') this.go(this.index + 1)
    }
    document.addEventListener('keydown', onKey)
    this.effect(() => () => document.removeEventListener('keydown', onKey))
  }

  private render(): void {
    const state = lightboxState()
    if (!state) {
      this.classList.remove('open')
      this.replaceChildren()
      return
    }

    this.images = state.images
    this.index = state.idx
    this.alt = state.alt

    this.renderShell()
    this.classList.add('open')
  }

  private renderShell(): void {
    this.innerHTML = `
      <button type="button" class="close">
        <svg class="icon icon-cancel icon--fn" aria-hidden="true">
          <use href="#icon-cancel"/>
        </svg>
      </button>
      <img class="gallery-image" alt=""/>
      <div class="nav-wrap">
        <div class="navigation"></div>
      </div>
    `

    // Set through the DOM rather than interpolated into the
    // markup, so a translation containing a quote or angle
    // bracket can't break the attribute (same rule as the
    // footer's locale picker).
    this.querySelector('.close')!
      .setAttribute('aria-label', t(i18n.labels, 'gallery.close'))

    this.bindCloseButton()
    this.bindNavClick()
    this.paint()
  }

  private bindCloseButton(): void {
    const btn = this.querySelector('.close')!
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      close()
    })
  }

  private bindNavClick(): void {
    const nav = this.querySelector('.navigation') as HTMLElement
    const activate = (target: EventTarget | null, e: Event): void => {
      e.stopPropagation()

      // closest() so a click/keypress landing on a chevron's
      // inner icon still resolves to the control.
      const btn = (target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-action], [data-page]',
      )
      if (!btn) return
      const action = btn.dataset.action
      const page = btn.dataset.page
      if (action === 'prev') this.go(this.index - 1)
      else if (action === 'next') this.go(this.index + 1)
      else if (page) this.go(parseInt(page, 10) - 1)
    }
    nav.addEventListener('click', (e) => activate(e.target, e))
    nav.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      activate(e.target, e)
    })
  }

  private bindTouch(): void {
    this.addEventListener('touchstart', (e) => {
      e.stopPropagation()
      this.touchStartX = e.touches[0].clientX
      this.touchStartY = e.touches[0].clientY
      this.touchAxis = null
    }, { passive: true })

    this.addEventListener('touchmove', (e) => {
      e.stopPropagation()
      const dx = e.touches[0].clientX - this.touchStartX
      const dy = e.touches[0].clientY - this.touchStartY
      if (this.touchAxis === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        this.touchAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      }
      if (this.touchAxis === 'x') e.preventDefault()
    }, { passive: false })

    this.addEventListener('touchend', (e) => {
      e.stopPropagation()
      const dx = e.changedTouches[0].clientX - this.touchStartX
      const dy = e.changedTouches[0].clientY - this.touchStartY
      if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
        this.go(this.index + (dx < 0 ? 1 : -1))
      }
      this.touchAxis = null
    })
  }

  // Trackpad / wheel-mouse horizontal swipe, same commit
  // threshold as the deck so the feel matches. Latches
  // between commits so a single fling doesn't race
  // through five images.
  private bindWheel(): void {
    this.addEventListener('wheel', (e) => this.onWheel(e), { passive: false })
  }

  private onWheel(e: WheelEvent): void {
    const ax = Math.abs(e.deltaX)
    const ay = Math.abs(e.deltaY)
    if (ax < WHEEL_AXIS_LOCK_PX || ax < ay) return

    e.preventDefault()
    e.stopPropagation()
    this.scheduleWheelReset()

    if (this.wheelLatched) return
    this.wheelAccum += e.deltaX

    if (Math.abs(this.wheelAccum) < WHEEL_THRESHOLD) return
    this.wheelLatched = true
    this.go(this.index + (this.wheelAccum > 0 ? 1 : -1))
  }

  private scheduleWheelReset(): void {
    clearTimeout(this.wheelResetTimer)
    this.wheelResetTimer = window.setTimeout(() => {
      this.wheelAccum = 0
      this.wheelLatched = false
    }, WHEEL_RESET_MS)
  }

  private go(idx: number): void {
    const total = this.images.length
    if (total === 0) return

    const wrapped = ((idx % total) + total) % total
    if (wrapped === this.index) return
    this.index = wrapped
    this.paint()
  }

  private paint(): void {
    const img = this.querySelector('.gallery-image') as HTMLImageElement
    const nav = this.querySelector('.navigation') as HTMLElement

    img.src = this.images[this.index].large
    img.alt = `${this.alt} (${this.index + 1} / ${this.images.length})`

    if (this.images.length > 1) {
      nav.replaceChildren(navFragment(this.index, this.images.length))
    } else {
      nav.replaceChildren()
    }
  }
}

function close(): void {
  lightboxState.set(null)
}

customElements.define('dpp-lightbox', DppLightbox)
