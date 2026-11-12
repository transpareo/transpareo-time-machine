/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shared chrome for modal-overlay components. Three
 * duplications were enough to justify the extraction.
 *
 * The host element is its own overlay. The helper wires
 * Escape, the platform Back gesture, body-scroll-lock,
 * overlay click-outside (with mousedown-origin tracking so
 * a text-selection drag from inside the dialog doesn't
 * close on release), and a focus trap.
 *
 * Caller passes its own `effect` callback so the helper
 * can register reactive subscriptions and disposers
 * scoped to the host's lifecycle.
 */

import { icon } from '@/icons'
import { i18n } from '@/i18n'
import { t } from '@/i18n/labels'

type Effect = (fn: () => void | (() => void)) => void

interface ModalChrome {
  /** Returns true when the modal is currently shown. */
  isOpen: () => boolean
  /** Invoked on Escape, click-outside, or any other dismiss path. */
  onClose: () => void
  /**
   * Where focus lands as the dialog opens: its first control
   * by default, or the dialog itself for a viewer the arrow
   * keys drive, where a focused control would ring at the
   * first key press.
   */
  initialFocus?: 'host'
}

export function bindModalChrome(
  host: HTMLElement, effect: Effect, opts: ModalChrome,
): void {
  // Every overlay host this helper is bound to is a
  // modal dialog by definition, so the two ARIA
  // attributes are set centrally instead of repeated in
  // each component's setup. `role=dialog` + `aria-modal`
  // are idempotent (writing the same value twice is a
  // no-op), so callers that already set them by hand
  // are still safe.
  host.setAttribute('role', 'dialog')
  host.setAttribute('aria-modal', 'true')
  // Focusable fallback target when the dialog has no
  // focusable children yet.
  if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '-1')
  bindEscape(effect, opts)
  bindBodyScrollLock(effect, opts)
  bindClickOutside(host, effect, opts)
  bindFocusTrap(host, effect, opts)
  bindHistoryBack(effect, opts)
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableWithin(host: HTMLElement): HTMLElement[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((node) => node.offsetParent !== null)
}

// The control a keyboard user is on, told apart from its
// twins: a dialog that redraws builds the same controls
// anew, so the match in the new content is found by key.
interface HeldControl {
  node: HTMLElement
  key: string
  nth: number
}

// What a control is, as far as a redrawn dialog can tell:
// its tag, its classes and the name it carries.
function controlKey(node: HTMLElement): string {
  const name = node.getAttribute('aria-label') ?? node.textContent
  return `${node.tagName}.${node.className}|${name}`
}

function holdControl(host: HTMLElement, node: HTMLElement): HeldControl {
  const key = controlKey(node)
  const twins = focusableWithin(host).filter((n) => controlKey(n) === key)
  return { node, key, nth: Math.max(twins.indexOf(node), 0) }
}

// Focus the held control's match in the dialog's current
// content, or its first control, or the dialog itself.
function focusInside(host: HTMLElement, held: HeldControl | null): void {
  const focusables = focusableWithin(host)
  const twins = focusables.filter((n) => controlKey(n) === held?.key)
  const target = twins[held?.nth ?? 0] ?? twins[0] ?? focusables[0] ?? host
  target.focus()
}

// Focus falls onto the page itself when the focused node
// is removed; anywhere else it was put there on purpose.
function focusDropped(): boolean {
  const active = document.activeElement
  return !active || active === document.body
}

// Keep keyboard focus inside an open dialog: move focus in
// on open, keep it on its control when the dialog redraws,
// wrap Tab/Shift-Tab at the boundaries, and restore focus
// to the previously-focused element on close. Without this
// the asserted aria-modal="true" lies to assistive tech,
// since Tab would walk into the still-live page behind the
// overlay.
function bindFocusTrap(
  host: HTMLElement, effect: Effect, opts: ModalChrome,
): void {
  let previouslyFocused: HTMLElement | null = null
  let held: HeldControl | null = null

  const onFocusin = (e: FocusEvent): void => {
    held = holdControl(host, e.target as HTMLElement)
  }

  // A dialog redraws its whole content when data lands,
  // which detaches the control a keyboard user is on.
  const observer = new MutationObserver(() => {
    if (!opts.isOpen() || !held || held.node.isConnected) return
    if (focusDropped()) focusInside(host, held)
  })

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab' || !opts.isOpen()) return
    const focusables = focusableWithin(host)
    if (focusables.length === 0) {
      e.preventDefault()
      host.focus()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const root = host.getRootNode() as Document | ShadowRoot
    const active = root.activeElement

    // From the dialog itself, Tab enters its controls at
    // either end; left alone, the browser would move on to
    // the page behind.
    if (active === host) {
      e.preventDefault()
      const target = e.shiftKey ? last : first
      target.focus()
      return
    }
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  effect(() => {
    if (!opts.isOpen()) return
    const root = host.getRootNode() as Document | ShadowRoot
    previouslyFocused = root.activeElement as HTMLElement | null

    // Every dialog renders its content in the pass that opens
    // it, so the content is mounted by the next microtask. A
    // frame would wait on whatever else keeps the page busy.
    queueMicrotask(() => {
      if (!opts.isOpen()) return
      if (opts.initialFocus === 'host') host.focus()
      else focusInside(host, null)
    })
    host.addEventListener('keydown', onKeydown)
    host.addEventListener('focusin', onFocusin)
    observer.observe(host, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      host.removeEventListener('focusin', onFocusin)
      host.removeEventListener('keydown', onKeydown)
      held = null
      previouslyFocused?.focus?.()
      previouslyFocused = null
    }
  })
}

function bindEscape(effect: Effect, opts: ModalChrome): void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !opts.isOpen()) return

    // Claim the dismissal: one keypress closes one layer.
    // Surfaces underneath (the full timeline's window-level
    // Escape handler) skip an already-consumed event.
    e.preventDefault()
    opts.onClose()
  }
  document.addEventListener('keydown', onKey)
  effect(() => () => document.removeEventListener('keydown', onKey))
}

function bindBodyScrollLock(effect: Effect, opts: ModalChrome): void {
  effect(() => {
    if (!opts.isOpen()) return

    // Locking releases the root's reserved scrollbar
    // gutter (html:has(body.no-scroll) in app.css) so
    // the overlay's scrollbar can take the page one's
    // edge slot. Measure the released width before the
    // class flips and give it back as body padding, so
    // the page behind the backdrop does not reflow.
    const gutter = window.innerWidth
      - document.documentElement.getBoundingClientRect().width
    document.body.classList.add('no-scroll')
    if (gutter > 0) document.body.style.paddingRight = `${gutter}px`
    return () => {
      document.body.classList.remove('no-scroll')
      document.body.style.paddingRight = ''
    }
  })
}

function bindClickOutside(
  host: HTMLElement, effect: Effect, opts: ModalChrome,
): void {
  // Track mousedown origin so a text-selection drag that
  // starts inside the dialog and releases on the overlay
  // does not close the modal.
  let downOnHost = false
  const onDown = (e: MouseEvent): void => {
    downOnHost = e.target === host
  }
  const onClick = (e: MouseEvent): void => {
    if (e.target === host && downOnHost) opts.onClose()
  }
  host.addEventListener('mousedown', onDown)
  host.addEventListener('click', onClick)
  // Dispose with the host's lifecycle so a reconnect does
  // not stack a second pair of listeners (duplicate closes).
  effect(() => () => {
    host.removeEventListener('mousedown', onDown)
    host.removeEventListener('click', onClick)
  })
}

// Marker on the history entry an open modal pushes, so the
// pushed state is identifiable in devtools and never read
// as a real navigation.
const MODAL_HISTORY_STATE = { transpareoTimeMachineModal: true }

function isModalHistoryState(state: unknown): boolean {
  return !!state
    && typeof state === 'object'
    && (state as { transpareoTimeMachineModal?: unknown })
      .transpareoTimeMachineModal === true
}

// A host that drives navigation itself (Turbo, a
// client-side router) leaves its own state object on the
// entry we are sitting on. Taking the Back gesture there
// means pushing an entry and traversing back off it, and
// that traversal is a popstate the host reads as a
// navigation: it re-renders the page under us, so closing a
// modal visibly reloads the host's page. Measured on a
// Turbo-driven host, where a bare push-then-back with no
// modal involved reproduces it, so the trigger is the
// traversal rather than anything about our entry.
//
// Where the entry is not ours to move, we leave it alone
// and Back means what the host means by Back.
function foreignHistoryState(): boolean {
  const state = window.history.state
  return state != null && !isModalHistoryState(state)
}

// Back-button / swipe-back dismissal. While the modal is
// open one extra entry sits on the history stack, so the
// platform Back gesture pops that entry and closes the
// modal instead of navigating the host page away. Any other
// dismissal (Escape, click-outside, the close button) pops
// the entry back off so the stack stays balanced.
//
// The entry carries the current URL unchanged: it is a pure
// dismissal breakpoint, leaving the address bar and the
// timeline's own hash sync untouched.
function bindHistoryBack(effect: Effect, opts: ModalChrome): void {
  if (typeof window === 'undefined') return

  // Persist across effect re-runs. `pushed` tracks whether
  // our entry is on the stack so a re-run while the modal
  // stays open (openModal swapping one dialog for another)
  // does not stack a second entry. `dismissedByPop` records
  // that a Back already discarded the entry, so the close
  // path must not pop a second time.
  let pushed = false
  let dismissedByPop = false

  const onPop = (): void => {
    if (!opts.isOpen()) return
    dismissedByPop = true
    opts.onClose()
  }

  // Pop our entry to keep the stack balanced, but only if it
  // is still on top. A modal that navigates as it closes (the
  // proof modal's version rows jump into the timeline) pushes
  // a fresh entry synchronously right after close(), burying
  // our marker; popping then would rewind that navigation.
  // Deferring past the close() call lets that push land first,
  // so `history.state` reflects the real top before we decide.
  const rebalance = (): void => {
    queueMicrotask(() => {
      if (opts.isOpen()) return
      if (!isModalHistoryState(window.history.state)) return
      window.history.back()
    })
  }

  effect(() => {
    const open = opts.isOpen()
    if (open && !pushed) {
      if (foreignHistoryState()) return
      pushed = true
      dismissedByPop = false
      window.history.pushState(MODAL_HISTORY_STATE, '')
    } else if (!open && pushed) {
      pushed = false
      if (!dismissedByPop) rebalance()
    }

    if (!open) return
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  })
}

interface ModalOptions {
  /** Title content for the standard `.modal-header`.
   *  String or Node so callers can prepend an icon
   *  (e.g. the rating smiley) without re-styling the
   *  header. */
  title: string | Node
  /** Optional id on the title element, for use with
   *  `aria-labelledby` on the host overlay. */
  titleId?: string
  /** Body content appended to `.modal-body`. Pass a
   *  DocumentFragment to spread multiple top-level
   *  children directly into the body. A string is set as
   *  textContent (escaped), never parsed as HTML. */
  body: string | HTMLElement | DocumentFragment
  /** Optional accent colour exposed to the dialog as
   *  `--accent` so the header gradient can pick it up. */
  accent?: string
  /** Click handler for the `.modal-close` button. */
  onClose: () => void
}

// Build the standard modal dialog: `.modal > .modal-header
// (h1.modal-title + button.modal-close) + .modal-body`.
//
// One chrome shape for every modal here, so the same
// CSS conventions apply across the codebase. The
// caller is responsible for placing the returned element
// inside its overlay host.
export function buildModal(opts: ModalOptions): HTMLElement {
  const dialog = document.createElement('div')
  dialog.className = 'modal'
  if (opts.accent) dialog.style.setProperty('--accent', opts.accent)

  dialog.appendChild(buildHeader(opts))

  const body = document.createElement('div')
  body.className = 'modal-body'
  if (typeof opts.body === 'string') body.textContent = opts.body
  else body.appendChild(opts.body)
  dialog.appendChild(body)

  return dialog
}

function buildHeader(opts: ModalOptions): HTMLElement {
  const header = document.createElement('header')
  header.className = 'modal-header'

  const titleEl = document.createElement('h1')
  titleEl.className = 'modal-title'
  titleEl.append(opts.title)
  if (opts.titleId) titleEl.id = opts.titleId

  header.append(titleEl, buildCloseButton(opts.onClose))
  return header
}

function buildCloseButton(onClose: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'modal-close'
  btn.setAttribute('aria-label', t(i18n.labels, 'modal.close'))
  btn.appendChild(icon('cancel'))
  btn.addEventListener('click', onClose)
  return btn
}
