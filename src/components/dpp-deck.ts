/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-deck>, wraps the live card and the past/future
 * "version shadows" that fan out behind it. Owns the
 * dragProgress-driven CSS-var styling for both the live
 * card (its first child, `<article class="card">`) and
 * the keyed shadow elements. Multi-step navigation
 * animations are driven by `navByEventId` in actions.ts.
 */

import { LightElement } from '@/reactive/element'
import { computed } from '@/reactive/signals'
import { el } from '@/reactive/dom'
import { i18n } from '@/i18n'
import { t } from '@/i18n/labels'
import { REVEAL_TOTAL_MS, prefersReducedMotion } from '@/motion'
import {
  sortedEvents, focusIndex, focusedEventId, dragProgress,
  dragActive, isResidualNav, previewEventId, SHADOW_DEPTH_CAP,
  timelineState, isMobile,
} from '@/state'
import {
  deckWheel, deckTouchStart, deckTouchMove, deckTouchEnd,
  cancelPendingGesture,
} from '@/gestures'

const SHADOW_X_STEP = 28
const SHADOW_Y_STEP = 8

// Drop scale step so the bottom gap (caused by the scale
// shrinking around top-left) is small. With 0.04 the
// depth-1 shadow's bottom sat ~86px above the active
// card's bottom (4% of a 2155px card); 0.01 brings it
// down to ~22px.
const SHADOW_SCALE_STEP = 0.01

// Ghost-card opacity ramp. Closest shadow (abs=1) sits
// at SHADOW_OPACITY_HIGH; deepest (abs=SHADOW_DEPTH_CAP)
// sits at SHADOW_OPACITY_LOW; depths in between are
// linear. The live card uses the same ramp from
// `1` at abs=0 down to SHADOW_OPACITY_HIGH at abs=1
// so its drag fade meets the closest shadow at the
// same opacity (no visual jolt at the handoff).
const SHADOW_OPACITY_HIGH = 0.4
const SHADOW_OPACITY_LOW = 0.04
const SHADOW_BLUR_STEP = 0.8

function shadowOpacity(abs: number): number {
  if (abs <= 0) return 1
  if (abs <= 1) {
    return 1 - abs * (1 - SHADOW_OPACITY_HIGH)
  }
  const t = (abs - 1) / (SHADOW_DEPTH_CAP - 1)
  return Math.max(
    SHADOW_OPACITY_LOW,
    SHADOW_OPACITY_HIGH
      - t * (SHADOW_OPACITY_HIGH - SHADOW_OPACITY_LOW),
  )
}

interface SlotStyle {
  x: number
  y: number
  scale: number
  opacity: number
  blur: number
  z: number
}

interface ShadowItem {
  id: string
  baseSlot: number
  isPast: boolean
}

const visibleShadows = computed<ShadowItem[]>(() => {
  const list = sortedEvents()
  const idx = focusIndex()
  const out: ShadowItem[] = []

  for (let d = 1; d <= SHADOW_DEPTH_CAP; d++) {
    const past = idx - d
    if (past >= 0) {
      out.push({ id: `s-${list[past].id}`, baseSlot: -d, isPast: true })
    }
    const fwd = idx + d
    if (fwd < list.length) {
      out.push({ id: `s-${list[fwd].id}`, baseSlot: d, isPast: false })
    }
  }
  return out
})

const SHADOW_FADE_MS = 220

class DppDeck extends LightElement {
  private shadowEls = new Map<string, HTMLDivElement>()
  private gesturesBound = false
  private overlayEl: HTMLElement | null = null
  private overlayReleaseAnim: Animation | null = null
  private prevResidual = false
  private prevDragActive = false
  private prevHidden = true

  disconnectedCallback(): void {
    // Drop any in-flight wheel debounce so it can't fire
    // against this detached deck after teardown.
    cancelPendingGesture()
    super.disconnectedCallback()
  }

  protected setup(): void {
    this.setAttribute('role', 'region')
    this.setAttribute('aria-label', t(i18n.labels, 'deck.label'))

    this.bindGestures()
    this.bindReactivity()
  }

  private bindGestures(): void {
    // setup() re-runs on every reconnect, but the host node
    // keeps its listeners across disconnection; bind once
    // or each re-mount would stack a duplicate set.
    if (this.gesturesBound) return
    this.gesturesBound = true
    this.addEventListener('wheel', deckWheel, { passive: false })
    this.addEventListener('touchstart', deckTouchStart, { passive: true })
    this.addEventListener('touchmove', deckTouchMove, { passive: false })
    this.addEventListener('touchend', deckTouchEnd)
    this.addEventListener('touchcancel', deckTouchEnd)

    // Clean up any half-finished overlay when a new gesture begins
    // animateDragTo's cancelReleaseAnim path doesn't run our WAAPI.
    this.addEventListener('touchstart', () => {
      if (this.overlayEl && this.overlayReleaseAnim) {
        this.cleanupOverlay()
      }
    }, { passive: true })
  }

  private bindReactivity(): void {
    this.effect(() => {
      visibleShadows()
      dragProgress()
      focusIndex()
      focusedEventId()
      isMobile()
      this.renderShadows()
    })

    this.effect(() => {
      dragProgress()
      isMobile()
      this.styleLiveCard()
    })

    this.effect(() => {
      this.classList.toggle('mobile', isMobile())
    })

    this.effect(() => {
      this.classList.toggle('deck-driven', dragActive())
    })

    // Mobile clone-and-swap overlay lifecycle.
    // When the user starts dragging on mobile, snapshot the live
    // card as an overlay, swap focusedEventId to the target, and
    // let the overlay slide with the swipe while the (now-updated)
    // live card sits underneath. On commit the overlay swipes all
    // the way off-screen; on cancel it slides back to centre and
    // we revert focusedEventId.
    this.effect(() => {
      const drag = dragProgress()
      if (
        drag !== 0
        && isMobile.peek()
        && !this.overlayEl
        && dragActive.peek()
        && !this.overlayReleaseAnim
      ) {
        this.setupOverlay(drag)
      }
    })

    this.effect(() => {
      const drag = dragProgress()
      if (
        this.overlayEl && !this.overlayReleaseAnim && isMobile.peek()
      ) {
        this.updateOverlayX(drag)
      }
    })

    this.effect(() => {
      const residual = isResidualNav()
      if (!this.prevResidual && residual && this.overlayEl) {
        this.startOverlayCommit()
      }
      this.prevResidual = residual
    })

    this.effect(() => {
      const active = dragActive()
      if (
        this.prevDragActive && !active
        && this.overlayEl && !this.overlayReleaseAnim
      ) {
        // Drag ended without commit. Overlay has been
        // following dragProgress back to 0 via updateOverlayX,
        // so it's at centre. Clear the preview and tear down
        // under cover, focusedEventId never moved during the
        // gesture, so nothing to revert.
        this.cleanupOverlay()
      }
      this.prevDragActive = active
    })

    // Trigger the staggered reveal animation only on
    // the first opening, when the user is restoring a
    // previously-focused version we skip the build-in
    // because the deck is already shuffling for them.
    this.effect(() => {
      const hidden = timelineState() === 'hidden'
      if (this.prevHidden && !hidden && focusedEventId.peek() == null) {
        this.dataset.revealing = ''
        window.setTimeout(() => {
          delete this.dataset.revealing
        }, REVEAL_TOTAL_MS)
      }
      this.prevHidden = hidden
    })
  }

  private renderShadows(): void {
    // Don't render the shadow stack while the timeline
    // is hidden, the stack is purely cosmetic, and
    // skipping it saves the CSS-var pumping per frame.
    // Existing nodes get torn down on transition into
    // hidden so the next reveal triggers a fresh build.
    // On mobile the stack is dropped entirely, the
    // layout is full-bleed and a single peek behind the
    // live card carries the depth cue instead.
    if (timelineState() === 'hidden' || isMobile()) {
      this.teardownShadows()
      return
    }

    const list = visibleShadows()
    const seen = new Set<string>()

    for (const item of list) {
      seen.add(item.id)
      const el = this.shadowEls.get(item.id) ?? this.mountShadow(item)

      // Re-sync the past/fwd class every render: shadow
      // elements are keyed by event id, so when the
      // visitor scrubs and an event flips from past to
      // forward (or vice versa) the existing node keeps
      // its original `--past` / `--fwd` class, which
      // sets `transform-origin: left top` vs `right top`
      // and so anchors the per-depth scale on the wrong
      // edge, breaking the visual stack.
      el.className = item.isPast
        ? 'card-shadow card-shadow--past'
        : 'card-shadow card-shadow--fwd'
      const slotN = item.baseSlot - dragProgress()
      applyShadowVars(el, slotStyle(slotN))
    }

    for (const [id, el] of this.shadowEls) {
      if (!seen.has(id)) {
        el.remove()
        this.shadowEls.delete(id)
      }
    }
  }

  private teardownShadows(): void {
    for (const el of this.shadowEls.values()) el.remove()
    this.shadowEls.clear()
  }

  private mountShadow(item: ShadowItem): HTMLDivElement {
    const node = el(
      'div',
      item.isPast
        ? 'card-shadow card-shadow--past'
        : 'card-shadow card-shadow--fwd',
    )
    node.setAttribute('aria-hidden', 'true')

    // Reveal stagger: closer-to-live shadows fade in
    // first, deeper ones later. Spreads the budget
    // (REVEAL_TOTAL_MS minus the fade duration) across
    // the depth levels so the fan reads as fanning out.
    const depth = Math.abs(item.baseSlot)
    const window = REVEAL_TOTAL_MS - SHADOW_FADE_MS
    const delay = ((depth - 1) / SHADOW_DEPTH_CAP) * window
    node.style.setProperty('--enter-delay', `${Math.round(delay)}ms`)
    this.appendChild(node)
    this.shadowEls.set(item.id, node)
    return node
  }

  private styleLiveCard(): void {
    const card = this.querySelector('.card') as HTMLElement | null
    if (!card) return

    if (isMobile()) {
      // Live card stays at rest on mobile, the swipe is
      // performed by an overlay clone (see overlay
      // lifecycle in bindReactivity). Reset all the desktop
      // slot vars in case a previous desktop frame left
      // them non-neutral.
      card.style.setProperty('--card-x', '0px')
      card.style.setProperty('--card-y', '0px')
      card.style.setProperty('--card-scale', '1')
      card.style.setProperty('--card-opacity', '1')
      card.style.setProperty('--card-blur', '0px')
      return
    }

    const liveSlot = -dragProgress()
    const s = liveSlotStyle(liveSlot)
    card.style.setProperty('--card-x', `${s.x}px`)
    card.style.setProperty('--card-y', `${s.y}px`)
    card.style.setProperty('--card-scale', String(s.scale))
    card.style.setProperty('--card-opacity', String(s.opacity))
    card.style.setProperty('--card-blur', `${s.blur}px`)
  }

  // ─── Mobile overlay ─────────────────────────────
  private setupOverlay(initialDrag: number): void {
    const list = sortedEvents()
    const idx = focusIndex()

    // Mobile flips the touch dx, so dragProgress < 0 maps to a
    // swipe-right gesture, which commits to PREVIOUS (-1).
    // dragProgress > 0 maps to swipe-left, which commits to
    // NEXT (+1).
    const dirSign = initialDrag < 0 ? -1 : +1
    const targetIdx = idx + dirSign
    if (targetIdx < 0 || targetIdx >= list.length) return
    const target = list[targetIdx]

    const liveCard =
      this.querySelector(':scope > .card') as HTMLElement | null
    if (!liveCard) return

    const overlay = el('div', 'card-overlay')
    overlay.setAttribute('aria-hidden', 'true')
    overlay.appendChild(staticClone(liveCard))
    this.appendChild(overlay)
    this.overlayEl = overlay

    // Render the target version's content on the live card
    // *behind* the overlay during the gesture, without
    // touching focusedEventId, that stays where it was so
    // the timeline dot doesn't flash to the target until
    // commit. previewEventId is read by activeSnapshot only.
    previewEventId.set(target.id)
    this.updateOverlayX(initialDrag)
  }

  private updateOverlayX(drag: number): void {
    if (!this.overlayEl) return
    const w = this.overlayEl.clientWidth || this.clientWidth

    // drag < 0 is swipe right, so the overlay moves right (+x).
    // drag > 0 is swipe left, so the overlay moves left (-x).
    const x = -drag * w
    this.overlayEl.style.setProperty(
      '--overlay-x', `${Math.round(x)}px`,
    )
  }

  private startOverlayCommit(): void {
    if (!this.overlayEl) return
    const w = this.overlayEl.clientWidth || this.clientWidth
    const currentX =
      parseFloat(
        this.overlayEl.style.getPropertyValue('--overlay-x'),
      ) || 0

    // Continue in the direction the overlay was already moving,
    // all the way past the viewport edge.
    const exitX = currentX < 0 ? -w : w
    this.overlayReleaseAnim = this.overlayEl.animate(
      [
        { transform: `translateX(${currentX}px)` },
        { transform: `translateX(${exitX}px)` },
      ],
      {
        // Reduced-motion: jump straight to the off-screen
        // end state instead of sliding (the CSS duration
        // override can't reach a WAAPI animation).
        duration: prefersReducedMotion() ? 0 : SHADOW_FADE_MS,
        easing: 'cubic-bezier(0, 0, 0.2, 1)',
        fill: 'forwards',
      },
    )
    this.overlayReleaseAnim.onfinish = () => {
      this.cleanupOverlay()
    }
  }

  private cleanupOverlay(): void {
    if (this.overlayReleaseAnim) {
      this.overlayReleaseAnim.cancel()
      this.overlayReleaseAnim = null
    }
    if (this.overlayEl) {
      this.overlayEl.remove()
      this.overlayEl = null
    }
    previewEventId.set(null)
  }
}

// Snapshot the live card's outerHTML and rewrite every `<dpp-*`
// custom-element tag to a plain `<div>` so the overlay tree
// doesn't auto-upgrade and re-render against the now-swapped
// focusedEventId. Operates on a deep DOM clone so attribute
// values are never touched (a string-level rewrite over
// `outerHTML` would corrupt any attribute whose value
// contains the literal `dpp-`).
function staticClone(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement
  const swap = (target: Element): HTMLElement => {
    const div = el('div')
    div.setAttribute('data-was', target.tagName.toLowerCase())
    for (const attr of Array.from(target.attributes)) {
      div.setAttribute(attr.name, attr.value)
    }
    while (target.firstChild) div.appendChild(target.firstChild)
    target.replaceWith(div)
    return div
  }

  // Walk depth-first; replace any `dpp-*` element with a
  // `<div>` clone carrying the same attributes + children.
  const root = clone.tagName.toLowerCase().startsWith('dpp-')
    ? swap(clone)
    : clone
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.tagName.toLowerCase().startsWith('dpp-')) swap(el)
  }
  return root
}


function slotStyle(slot: number): SlotStyle {
  const abs = Math.abs(slot)
  const sign = Math.sign(slot)
  return {
    x: sign * abs * SHADOW_X_STEP,
    y: abs * SHADOW_Y_STEP,
    scale: 1 - abs * SHADOW_SCALE_STEP,
    opacity: shadowOpacity(abs),
    blur: abs * SHADOW_BLUR_STEP,
    z: SHADOW_DEPTH_CAP - Math.floor(abs) + 1,
  }
}

function liveSlotStyle(slot: number): SlotStyle {
  const abs = Math.abs(slot)
  const sign = Math.sign(slot)
  const x = sign * abs * SHADOW_X_STEP
  const y = abs * SHADOW_Y_STEP
  const scale = 1 - abs * SHADOW_SCALE_STEP
  const opacity = shadowOpacity(abs)

  // Floor while drag is non-zero so the blur survives
  // the last sub-pixel of position settling, the CSS
  // filter transition (longer than transform's) then
  // smooths the drop to 0 once the JS animation
  // releases dragProgress at exactly 0.
  const blur = abs === 0 ? 0 : Math.max(Math.sqrt(abs) * 1.8, 0.8)

  return { x, y, scale, opacity, blur, z: 0 }
}

function applyShadowVars(el: HTMLElement, s: SlotStyle): void {
  el.style.setProperty('--shadow-x', `${s.x}px`)
  el.style.setProperty('--shadow-y', `${s.y}px`)
  el.style.setProperty('--shadow-scale', String(s.scale))
  el.style.setProperty('--shadow-opacity', String(s.opacity))
  el.style.setProperty('--shadow-blur', `${s.blur}px`)
  el.style.setProperty('--shadow-z', String(s.z))
}

customElements.define('dpp-deck', DppDeck)
