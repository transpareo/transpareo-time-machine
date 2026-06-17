/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-timeline>, the recessed time-strip at the top of
 * the page. Drives four visual states (hidden / hovered
 * / expanded / full) from the `timelineState` signal.
 *
 * Pure math lives in sibling modules:
 *   - ./layout    constants, Projection, layOut, etc.
 *   - ./ticks     time-axis tick computation
 *   - ./connectors  full-state SVG connector lines
 * This file keeps the class itself (DOM wiring, effect
 * scopes, render passes) plus the small DOM builders
 * those render passes call into.
 */

import { LightElement } from '@/reactive/element'
import { signal } from '@/reactive/signals'
import { el } from '@/reactive/dom'
import { REVEAL_TOTAL_MS, prefersReducedMotion } from '@/motion'
import {
  sortedEvents, focusedEventId, hoveredEventId, timelineState,
  displayedEvent,
} from '@/state'
import { eventModalEventId } from '../dpp-event-modal'
import {
  clickDot, setHoverEvent, openFullTimeline,
  revealTimeline, hideTimeline, navByEventId,
  closeFullTimeline,
} from '@/actions'
import {
  deckWheel, deckTouchStart, deckTouchMove, deckTouchEnd,
} from '@/gestures'
import { colorForEventType } from '@/event-colors'
import { eventTime } from '@/epcis'
import { icon } from '@/icons'
import { i18n, formatShortDate } from '@/i18n'
import { tx, type DppEvent } from '@/types'
import { t, type LabelKey } from '@/i18n/labels'
import {
  type Projection, PAD_X, CARD_W, CARD_GAP, CARD_H,
  buildLinearProjection, type LayoutItem, layOut,
  stageHeight, topYForLevel,
} from './layout'
import { computeTicks, labelFor } from './ticks'
import { buildConnectorLayer } from './connectors'

const DOT_FADE_MS = 220

// Mouse-drag distance before a press on the trough becomes
// a pan instead of a dot / card click.
const DRAG_SCROLL_PX = 5

class DppTimeline extends LightElement {
  private containerWidth = signal(800)
  private viewportHeight = signal(
    typeof window !== 'undefined' ? window.innerHeight : 800,
  )
  private lastActiveId: string | null = null
  private pulseEl: HTMLSpanElement | null = null

  protected setup(): void {
    this.innerHTML = `
      <div class="timeline">
        <div class="scroll-pane">
          <div class="tick-labels" aria-hidden="true"></div>
          <div class="ticks" aria-hidden="true"></div>
          <div class="strip">
            <div class="strip-line" aria-hidden="true"></div>
            <div class="events"></div>
          </div>
          <div class="full-area"></div>
        </div>
        <button type="button" class="nav-arrow nav-arrow-prev">
          <svg aria-hidden="true">
            <use href="#icon-down"></use>
          </svg>
        </button>
        <button type="button" class="nav-arrow nav-arrow-next">
          <svg aria-hidden="true">
            <use href="#icon-down"></use>
          </svg>
        </button>
        <div class="event-details" aria-live="polite"></div>
        <button type="button" class="versions-toggle">
          <svg class="icon icon--fn icon-history versions-show-icon"
            aria-hidden="true">
            <use href="#icon-history"></use>
          </svg>
          <svg class="icon icon--fn icon-cancel versions-hide-icon"
            aria-hidden="true">
            <use href="#icon-cancel"></use>
          </svg>
          <span class="versions-label"></span>
        </button>
        <button type="button" class="full-close-link">
          <span class="full-close-label"></span>
        </button>
        <button type="button" class="open-full-btn">
          <svg class="icon icon--fn icon-resize-full open-full-icon"
            aria-hidden="true">
            <use href="#icon-resize-full"></use>
          </svg>
          <svg class="icon icon--fn icon-cancel close-full-icon"
            aria-hidden="true">
            <use href="#icon-cancel"></use>
          </svg>
        </button>
      </div>
    `

    const wrap = this.querySelector('.timeline') as HTMLDivElement
    const scrollPane = this.querySelector('.scroll-pane') as HTMLDivElement
    const strip = this.querySelector('.strip') as HTMLDivElement
    const events = this.querySelector('.events') as HTMLDivElement
    const ticks = this.querySelector('.ticks') as HTMLDivElement
    const labels = this.querySelector('.tick-labels') as HTMLDivElement
    const details = this.querySelector('.event-details') as HTMLDivElement
    const fullArea = this.querySelector('.full-area') as HTMLDivElement
    const toggle = this.querySelector('.versions-toggle') as HTMLButtonElement
    const toggleLabel = this.querySelector('.versions-label')!
    const fullClose = this.querySelector('.full-close-link') as HTMLButtonElement
    const fullCloseLabel = this.querySelector('.full-close-label')!

    this.bindToggleButton(toggle)
    this.bindFullClose(fullClose)
    this.bindClicks(strip, events)
    this.observeWidth(wrap)
    this.bindStateClass(wrap)
    this.bindAutoScrollToActive(scrollPane)
    this.bindScrollFades(scrollPane)
    this.bindDragScroll(scrollPane)
    this.bindEscape()
    this.bindNavArrows()
    this.bindOpenFullButton()
    this.bindDetailsGestures(details)

    // Single-snapshot mode (and any DPP with no event feed)
    // has nothing to scrub, so hide the whole timeline,
    // including the "show history" toggle, when there are no
    // events. Reactive because the EPCIS feed loads after
    // mount in manifest mode.
    this.effect(() => {
      this.style.display = sortedEvents().length ? '' : 'none'
    })

    // Reflect the hovered event onto its connector path
    // so hovering a card or a strip dot highlights the
    // line that joins them.
    this.effect(() => {
      const id = hoveredEventId()
      const paths = this.querySelectorAll<SVGPathElement>(
        '.connector-svg path',
      )
      for (const p of paths) {
        p.classList.toggle('hovered', p.dataset.eventId === id)
      }
    })

    this.effect(() => this.renderEvents(events))
    this.effect(() => this.renderTicks(ticks, labels))
    this.effect(() => this.renderDetails(details))
    this.effect(() => this.renderFullArea(fullArea))
    this.effect(() => this.applyContentWidth(strip, ticks, labels, fullArea))
    const prevArrow = this.querySelector('.nav-arrow-prev') as HTMLButtonElement
    const nextArrow = this.querySelector('.nav-arrow-next') as HTMLButtonElement
    const openFull = this.querySelector('.open-full-btn') as HTMLButtonElement

    this.effect(() => {
      const labels = i18n.labels
      toggleLabel.textContent = timelineState() === 'hidden'
        ? t(labels, 'timeline.toggle.show')
        : t(labels, 'timeline.toggle.hide')
      fullCloseLabel.textContent = t(labels, 'timeline.full.close')
      prevArrow.setAttribute('aria-label', t(labels, 'timeline.prevEvent'))
      nextArrow.setAttribute('aria-label', t(labels, 'timeline.nextEvent'))
      openFull.setAttribute('aria-label', t(labels, 'timeline.full.toggle'))
    })
  }

  private applyContentWidth(...inner: HTMLElement[]): void {
    // Hidden state collapses the strip via max-height,
    // so the explicit width doesn't matter there. In
    // expanded and full we always use the pre-stretched
    // contentWidth so the strip dots stay put across
    // state changes.
    const visible = timelineState() !== 'hidden'
    const w = visible ? `${this.contentWidth()}px` : ''
    for (const el of inner) el.style.width = w
  }

  private bindFullClose(btn: HTMLButtonElement): void {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      closeFullTimeline()
    })
  }

  private bindEscape(): void {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return

      // A modal above the timeline already consumed this
      // Escape (its document-level handler runs first and
      // claims the event); one keypress closes one layer.
      if (e.defaultPrevented) return
      if (timelineState.peek() !== 'full') return
      e.preventDefault()
      closeFullTimeline()
    }
    window.addEventListener('keydown', onKey)
    this.effect(() => () => window.removeEventListener('keydown', onKey))
  }

  // left/right on the prev/next arrow buttons or keyboard
  // jumps the focused event by one. Keyboard navigation
  // is gated on the timeline being expanded so it
  // doesn't compete with native scrolling when hidden.
  private bindNavArrows(): void {
    const prev = this.querySelector('.nav-arrow-prev') as HTMLButtonElement
    const next = this.querySelector('.nav-arrow-next') as HTMLButtonElement
    prev.addEventListener('click', (e) => {
      e.stopPropagation()
      this.navStep(-1)
    })
    next.addEventListener('click', (e) => {
      e.stopPropagation()
      this.navStep(1)
    })

    const onKey = (e: KeyboardEvent): void => {
      if (timelineState.peek() === 'hidden') return
      if (e.target instanceof HTMLElement) {
        const t = e.target
        if (t.matches('input, textarea, select, [contenteditable]')) {
          return
        }
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        this.navStep(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        this.navStep(1)
      }
    }
    window.addEventListener('keydown', onKey)
    this.effect(() => () => window.removeEventListener('keydown', onKey))

    // Disabled state, gray the arrows out at either end.
    this.effect(() => {
      const list = sortedEvents()
      const focused = focusedEventId()
      const idx = focused
        ? list.findIndex((e) => e.id === focused)
        : list.length - 1
      prev.disabled = idx <= 0
      next.disabled = idx < 0 || idx >= list.length - 1
    })
  }

  // Wheel + touch on the event-details panel feeds the
  // same gesture pipeline the deck uses, so swiping or
  // scrolling the details navigates through versions
  // exactly like swiping the live card below does.
  private bindDetailsGestures(host: HTMLDivElement): void {
    host.addEventListener('wheel', deckWheel, { passive: false })
    host.addEventListener('touchstart', deckTouchStart, { passive: true })
    host.addEventListener('touchmove', deckTouchMove, { passive: false })
    host.addEventListener('touchend', deckTouchEnd)
    host.addEventListener('touchcancel', deckTouchEnd)
  }

  private bindOpenFullButton(): void {
    const btn = this.querySelector('.open-full-btn') as HTMLButtonElement
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (timelineState.peek() === 'full') closeFullTimeline()
      else openFullTimeline()
    })
  }

  private navStep(delta: number): void {
    const list = sortedEvents()
    if (!list.length) return
    const focused = focusedEventId.peek()
    const lastIdx = list.length - 1
    const idx = focused
      ? list.findIndex((e: DppEvent) => e.id === focused)
      : lastIdx
    const target = Math.max(0, Math.min(lastIdx, idx + delta))
    if (target === idx) return
    navByEventId(list[target].id)
  }

  private renderFullArea(host: HTMLDivElement): void {
    if (timelineState() !== 'full') {
      host.replaceChildren()
      return
    }
    const list = sortedEvents()
    if (list.length < 1) {
      host.replaceChildren()
      return
    }
    const projection = this.makeProjection()
    const cw = this.contentWidth()
    const rows = this.rowCount()
    const layout = layOut(list, rows, projection.xFor, cw)
    const stageH = stageHeight(layout)
    const focusedId = focusedEventId()

    const stage = el('div', 'card-stage')
    stage.style.width = `${cw}px`
    stage.style.height = `${stageH}px`

    stage.appendChild(buildConnectorLayer(layout, cw, stageH, focusedId))

    const onPick = (id: string) => (e: Event): void => {
      e.stopPropagation()
      navByEventId(id)
      closeFullTimeline()
    }
    layout.forEach((it, idx) => {
      const focused = it.evt.id === focusedId
      stage.appendChild(buildPanelCard(it, idx, focused, onPick(it.evt.id)))
    })
    host.replaceChildren(stage)
  }

  private renderDetails(host: HTMLDivElement): void {
    if (timelineState() !== 'expanded') {
      host.replaceChildren()
      return
    }
    const evt = displayedEvent()
    if (!evt) {
      host.replaceChildren()
      return
    }
    host.replaceChildren(buildDetails(evt))
  }

  private bindToggleButton(btn: HTMLButtonElement): void {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const state = timelineState.peek()
      if (state === 'hidden') revealTimeline()
      else hideTimeline()
    })
  }

  private bindClicks(strip: HTMLElement, events: HTMLElement): void {
    events.addEventListener('click', (e) => {
      const dot = (e.target as HTMLElement).closest('[data-event-id]')
      if (!(dot instanceof HTMLElement)) return
      e.stopPropagation()
      clickDot(dot.dataset.eventId!)
    })

    events.addEventListener('mouseover', (e) => {
      const dot = (e.target as HTMLElement).closest('[data-event-id]')
      if (dot instanceof HTMLElement) setHoverEvent(dot.dataset.eventId!)
    })

    events.addEventListener('mouseleave', () => setHoverEvent(null))

    strip.addEventListener('click', (e) => {
      // Empty-strip click toggles the full state: opens
      // it from expanded, closes it back to expanded
      // when full is already open. Clicks on dots are
      // handled by the dot click listener above.
      if ((e.target as HTMLElement).closest('[data-event-id]')) return
      if (timelineState.peek() === 'full') closeFullTimeline()
      else openFullTimeline()
    })
  }

  private prevState: 'hidden' | 'expanded' | 'full' = 'hidden'

  private bindStateClass(wrap: HTMLElement): void {
    this.effect(() => {
      const state = timelineState()
      wrap.dataset.state = state

      // Mirror onto the host so reveal-button vs.
      // timeline CSS can be driven from one place.
      this.dataset.state = state

      if (this.prevState === 'hidden' && state !== 'hidden') {
        // Stagger the dots in only on the FIRST reveal,
        // when the user is restoring a previously-focused
        // version, the page is already shuffling the deck
        // for them and the slow build-in feels redundant.
        if (focusedEventId.peek() == null) {
          this.dataset.revealing = ''
          window.setTimeout(() => {
            delete this.dataset.revealing
          }, REVEAL_TOTAL_MS)
        }
      }
      this.prevState = state
    })
  }

  private observeWidth(host: HTMLElement): void {
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.contentRect.width !== this.containerWidth.peek()) {
          this.containerWidth.set(e.contentRect.width)
        }
      }
    })
    ro.observe(host)
    const onResize = (): void => this.viewportHeight.set(window.innerHeight)
    window.addEventListener('resize', onResize)
    this.effect(() => () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
    })
  }

  // 2 rows only if the viewport is tall enough to show
  // both rows + the live card below comfortably. Below
  // the threshold (e.g. mobile landscape) the cards lay
  // out in a single row.
  private rowCount(): number {
    return this.viewportHeight() >= 600 ? 2 : 1
  }

  private renderEvents(host: HTMLDivElement): void {
    const list = sortedEvents()
    const { xFor } = this.makeProjection()
    const focusedId = focusedEventId()
    const hoveredId = hoveredEventId()
    const lastEvent = list.length ? list[list.length - 1] : null
    const activeId = focusedId ?? lastEvent?.id ?? null

    const activeChanged = activeId !== this.lastActiveId
    this.lastActiveId = activeId

    // Reveal animation: stagger right-to-left so the
    // newest dot pops in first, oldest last. Total
    // duration scales with event count so a 30-event
    // DPP doesn't take forever.
    const total = REVEAL_TOTAL_MS - DOT_FADE_MS
    const stagger = list.length > 1 ? total / (list.length - 1) : 0

    const fragments = list.map((evt, i) => {
      const x = xFor(eventTime(evt.occurredAt))
      const isActive = evt.id === activeId
      const isHovered = evt.id === hoveredId
      const delay = (list.length - 1 - i) * stagger
      const dot = buildEvent(evt, x, isActive, isHovered)
      dot.style.setProperty('--enter-delay', `${Math.round(delay)}ms`)
      return dot
    })
    host.replaceChildren(...fragments)

    if (activeChanged && activeId) {
      const active = list.find((e) => e.id === activeId)
      if (active) {
        if (this.pulseEl) this.pulseEl.remove()
        this.pulseEl = buildPulse(
          xFor(eventTime(active.occurredAt)),
          colorForEventType(active.eventType),
        )
        host.appendChild(this.pulseEl)
      }
    }
  }

  private renderTicks(
    ticksHost: HTMLDivElement, labelsHost: HTMLDivElement,
  ): void {
    const list = sortedEvents()
    if (list.length < 2) {
      ticksHost.replaceChildren()
      labelsHost.replaceChildren()
      return
    }

    const { xFor, isInGap } = this.makeProjection()
    const min = eventTime(list[0].occurredAt)
    const max = eventTime(list[list.length - 1].occurredAt)
    const { granularity, ticks } = computeTicks(min, max)

    // Skip ticks that fall inside a compressed gap so the
    // year label doesn't render under the gap marker.
    const labelled = ticks
      .map((ts) => ({ ts, text: labelFor(ts, granularity, i18n.locale) }))
      .filter((t) => t.text && !isInGap(t.ts))

    const tickEls = labelled.map(({ ts }) => {
      const span = el('span', 'tick')
      span.style.left = `${xFor(ts)}px`
      return span
    })
    ticksHost.replaceChildren(...tickEls)

    // Each year's label lives inside a slot sized to the
    // year's span. The slots flow inline left-to-right
    // (with a leading spacer so the first slot starts at
    // its tick's x). The label itself is
    // `position: sticky`, so the browser pins it to the
    // viewport's left edge while the slot is in view and
    // lets it slide off naturally as the next slot
    // scrolls in. No per-frame JS bookkeeping, only the
    // widths are written here, on render.
    const out: HTMLElement[] = []
    const firstX = xFor(labelled[0].ts)
    if (firstX > 0) {
      const spacer = el('span', 'tick-label-spacer')
      spacer.style.width = `${firstX}px`
      out.push(spacer)
    }

    // Shorten each slot by LABEL_LOOKAHEAD so the current
    // year's label scrolls out of view before the next
    // year's tick reaches the corner. The remaining gap
    // is filled by the next slot, which starts where this
    // one ends. Net effect: only one label is ever pinned
    // at the left edge at a time.
    const lookahead = 100
    for (let i = 0; i < labelled.length; i++) {
      const t = labelled[i]
      const x = xFor(t.ts)
      const nextX = i + 1 < labelled.length
        ? xFor(labelled[i + 1].ts)
        : null

      const slot = el('span', 'tick-label-slot')
      if (nextX !== null) {
        slot.style.width = `${Math.max(nextX - x - lookahead, 0)}px`
      }

      slot.appendChild(el('span', 'tick-label', t.text))
      out.push(slot)

      // Filler that occupies the lookahead gap between
      // this slot and the next, so the next slot still
      // starts at its tick's x position.
      if (nextX !== null) {
        const filler = el('span', 'tick-label-spacer')
        filler.style.width = `${Math.min(nextX - x, lookahead)}px`
        out.push(filler)
      }
    }
    labelsHost.replaceChildren(...out)
  }

  // Linear time projection across the pre-stretched
  // canvas, same xFor in expanded and full so the
  // strip's dot positions don't shift when the user
  // opens the full view. The CARD_W/2 inset reserves
  // room at each end so a card centred on the first or
  // last dot still fits within contentWidth.
  private makeProjection(): Projection {
    return buildLinearProjection(
      sortedEvents(), this.contentWidth(), CARD_W / 2,
    )
  }

  // The canvas is exactly wide enough to hold every card
  // as a grid of `rows` rows: ceil(events / rows) columns
  // of card-width plus the end padding. The row layout
  // redistributes cards within this width instead of
  // pushing past it, so the width follows the card count,
  // not the spread of time, and a dense cluster can never
  // stretch the strip beyond its card grid.
  private contentWidth(): number {
    const viewport = this.containerWidth()
    const list = sortedEvents()
    if (list.length === 0) return viewport
    const columns = Math.ceil(list.length / this.rowCount())
    const grid = columns * (CARD_W + CARD_GAP) - CARD_GAP + 2 * PAD_X
    return Math.max(viewport, grid)
  }

  // Edge fades on the trough indicate scrollable content
  // off-screen. Sets data-fade-left/right on the host
  // whenever the scroll position changes; CSS turns the
  // ::before / ::after gradients on accordingly. Also
  // re-pins the year-labels so they ride the scroll.
  private bindScrollFades(pane: HTMLDivElement): void {
    const update = (): void => {
      const scrollable = pane.scrollWidth - pane.clientWidth > 1
      const left = pane.scrollLeft > 1
      const right = pane.scrollLeft + pane.clientWidth
        < pane.scrollWidth - 1
      this.toggleAttribute('data-scrollable', scrollable)
      this.toggleAttribute('data-fade-left', left)
      this.toggleAttribute('data-fade-right', right)
    }
    pane.addEventListener('scroll', update, { passive: true })

    // Re-evaluate after layout changes (state, content,
    // viewport resize) so fades appear on first reveal.
    this.effect(() => {
      timelineState()
      sortedEvents()
      this.containerWidth()
      requestAnimationFrame(update)
    })
    this.effect(() => () => pane.removeEventListener('scroll', update))
  }

  // Mouse drag-to-scroll on the trough. The trackpad's
  // two-finger horizontal swipe pans the pane natively
  // (overflow-x: auto) and a vertical wheel is left to the
  // page, so a mouse otherwise has no way in: press and drag
  // left/right to pan the strip and the full grid. A drag
  // past a small threshold suppresses the dot/card click so
  // panning never navigates. Mouse-only; touch keeps native
  // scroll.
  private bindDragScroll(pane: HTMLDivElement): void {
    let moved = false
    let startX = 0
    let startScroll = 0

    const onMove = (e: PointerEvent): void => {
      const dx = e.clientX - startX
      if (!moved) {
        if (Math.abs(dx) < DRAG_SCROLL_PX) return
        moved = true
        this.toggleAttribute('data-grabbing', true)
      }
      pane.scrollLeft = startScroll - dx
      e.preventDefault()
    }
    const onUp = (): void => {
      this.toggleAttribute('data-grabbing', false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    pane.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.pointerType !== 'mouse') return
      moved = false
      startX = e.clientX
      startScroll = pane.scrollLeft
      // Track the rest of the drag on window so it keeps
      // panning even if the cursor leaves the trough.
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    })

    // A completed drag must not also fire the dot/card click
    // underneath it. Capture phase pre-empts the strip and
    // full-card click handlers; cleared for the next gesture.
    pane.addEventListener('click', (e) => {
      if (!moved) return
      moved = false
      e.stopPropagation()
      e.preventDefault()
    }, true)
  }

  // Keep the active dot in view, but only when the
  // active event itself changes (different focused id)
  // or the timeline is being revealed from hidden.
  // Toggling between expanded <-> full keeps the active
  // dot the same, so the scroll position is left alone
  // and the user's manual scroll is preserved.
  private bindAutoScrollToActive(pane: HTMLDivElement): void {
    let prevActiveId: string | null = null
    let prevState = timelineState.peek()
    this.effect(() => {
      const state = timelineState()
      if (state === 'hidden') {
        prevState = state
        return
      }
      const list = sortedEvents()
      if (!list.length) return
      const focusedId = focusedEventId()
      const last = list[list.length - 1]
      const active = focusedId
        ? list.find((e) => e.id === focusedId) ?? last
        : last
      const cameFromHidden = prevState === 'hidden'
      const activeChanged = active.id !== prevActiveId

      // Entering full state needs a re-scroll even when
      // the active id didn't change, the card layout is
      // only laid out in full, so the active card didn't
      // have an x to bracket against in the prior
      // expanded state.
      const enteredFull = state === 'full' && prevState !== 'full'
      prevActiveId = active.id
      prevState = state
      if (!cameFromHidden && !activeChanged && !enteredFull) return

      const xFor = this.makeProjection().xFor
      const x = xFor(eventTime(active.occurredAt))
      requestAnimationFrame(() => {
        const margin = 60
        const view = pane.clientWidth
        const max = pane.scrollWidth - view

        // In full state we also need the active card to
        // be on screen, not just its dot, they can sit
        // at quite different x's when the card has been
        // pushed lateral. Bracket the required viewport
        // range to cover both.
        let needLeft = x
        let needRight = x
        if (state === 'full') {
          const card = this.querySelector<HTMLElement>(
            `.panel-card[data-event-id="${CSS.escape(active.id)}"]`,
          )
          if (card) {
            const cardLeft = parseFloat(card.style.left)
            const cardRight = cardLeft + CARD_W
            needLeft = Math.min(needLeft, cardLeft)
            needRight = Math.max(needRight, cardRight)
          }
        }

        let next = pane.scrollLeft
        if (needLeft - margin < pane.scrollLeft) {
          next = Math.max(0, needLeft - margin)
        } else if (needRight + margin > pane.scrollLeft + view) {
          next = Math.min(max, needRight + margin - view)
        }
        if (next !== pane.scrollLeft) {
          // On first reveal, jump instantly so the dots
          // are on screen when the stagger animation
          // starts, a smooth scroll here would race the
          // fade-in and the user would miss it. For an
          // active-event change, smooth scroll feels
          // right because the user is navigating.
          const behavior = (cameFromHidden || prefersReducedMotion())
            ? 'auto'
            : 'smooth'
          pane.scrollTo({ left: next, behavior })
        }
      })
    })
  }
}

// ─── DOM builders called from the render passes ─────

function buildEvent(
  evt: DppEvent, x: number, active: boolean, hovered: boolean,
): HTMLButtonElement {
  const btn = el('button', 'event')
  btn.type = 'button'
  if (active) btn.classList.add('active')
  if (hovered) btn.classList.add('hovered')
  btn.dataset.eventId = evt.id

  // Use the localised event-type label so screen-reader
  // users hear "Lifecycle" / "Repair", not the raw enum
  // value (`lifecycle_transition` / `repair`).
  const tagKey = `eventType.${evt.eventType}` as LabelKey
  btn.setAttribute('aria-label', t(i18n.labels, tagKey))
  btn.style.left = `${x}px`
  btn.style.setProperty('--event-color', colorForEventType(evt.eventType))
  return btn
}

// One-shot expanding ring fired the moment a dot becomes
// active. Mounted only when the active id changes, on
// hover-only re-renders it does not restart.
function buildPulse(x: number, color: string): HTMLSpanElement {
  const p = el('span', 'active-pulse')
  p.style.left = `${x}px`
  p.style.setProperty('--event-color', color)
  return p
}

// The prose line shared by the expanded details panel and
// the full-state panel cards. The public EPCIS feed is
// PII-clean, so `description` is absent in production; fall
// back to a per-type summary so the body reads as a
// sentence rather than a bare tag + date. The summary takes
// a `{status}` placeholder (the lifecycle-transition copy
// names the new stage), filled from the event's statusTo.
function eventBodyText(evt: DppEvent): string {
  if (evt.description) return tx(evt.description, i18n.locale)
  const vars = evt.statusTo
    ? { status: t(i18n.labels, `status.${evt.statusTo}` as LabelKey) }
    : undefined
  return t(i18n.labels, `eventSummary.${evt.eventType}` as LabelKey, vars)
}

function buildDetails(evt: DppEvent): HTMLDivElement {
  const wrap = el('div', 'event-card event-details-card')
  wrap.style.setProperty('--event-color', colorForEventType(evt.eventType))
  wrap.setAttribute('role', 'button')
  wrap.setAttribute('tabindex', '0')
  wrap.setAttribute('aria-label', t(i18n.labels, 'event.details.aria'))
  const openModal = (): void => eventModalEventId.set(evt.id)
  wrap.addEventListener('click', openModal)
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openModal()
    }
  })

  const info = el('span', 'orb event-details-info')
  info.setAttribute('aria-hidden', 'true')
  info.appendChild(icon('info'))
  wrap.appendChild(info)

  const head = el('div', 'event-details-head')
  const tagKey = `eventType.${evt.eventType}` as LabelKey
  head.appendChild(el('span', 'event-tag', t(i18n.labels, tagKey)))
  head.appendChild(el(
    'span',
    'event-details-date',
    formatShortDate(evt.occurredAt, i18n.locale),
  ))
  wrap.appendChild(head)

  // The modal keeps the structured status/version grid, so
  // this prose body and the modal complement rather than
  // repeat.
  const desc = eventBodyText(evt)
  if (desc) {
    wrap.appendChild(el('p', 'event-details-desc', desc))
  }

  if (evt.actorLabel) {
    wrap.appendChild(el('p', 'event-details-actor', evt.actorLabel))
  }

  return wrap
}

function buildPanelCard(
  it: LayoutItem,
  idx: number,
  focused: boolean,
  onClick: (e: Event) => void,
): HTMLButtonElement {
  const evt = it.evt
  const card = el(
    'button',
    `event-card panel-card${focused ? ' focused' : ''}`,
  )
  card.type = 'button'
  card.dataset.eventId = evt.id
  card.style.left = `${it.cardX}px`
  card.style.top = `${topYForLevel(it.level)}px`
  card.style.width = `${it.width}px`
  card.style.height = `${CARD_H}px`

  // --accent drove the (now-removed) card border/stripe.
  // --event-color is what `.event-tag` reads so the pill
  // inside the card renders in the event's own colour.
  const evtColor = colorForEventType(evt.eventType)
  card.style.setProperty('--accent', evtColor)
  card.style.setProperty('--event-color', evtColor)
  card.style.setProperty('--enter-delay', `${30 + idx * 36}ms`)

  card.addEventListener('click', onClick)
  card.addEventListener('mouseenter', () => setHoverEvent(evt.id))
  card.addEventListener('mouseleave', () => setHoverEvent(null))

  card.appendChild(buildPanelCardHead(evt))

  const desc = eventBodyText(evt)
  if (desc) {
    card.appendChild(el('p', 'panel-card-desc', desc))
  }
  if (evt.actorLabel) {
    card.appendChild(el('p', 'panel-card-actor', evt.actorLabel))
  }
  return card
}

function buildPanelCardHead(evt: DppEvent): HTMLDivElement {
  const head = el('div', 'panel-card-head')
  const tagKey = `eventType.${evt.eventType}` as LabelKey
  head.appendChild(el('span', 'event-tag', t(i18n.labels, tagKey)))
  head.appendChild(el(
    'span',
    'panel-card-date',
    formatShortDate(evt.occurredAt, i18n.locale),
  ))
  return head
}

customElements.define('dpp-timeline', DppTimeline)
