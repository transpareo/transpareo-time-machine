/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Shared chrome for modal-overlay components. Inspired
 * by backend/utils/modal.js, three duplications were
 * enough to justify the extraction.
 *
 * The host element is its own overlay. The helper wires
 * Escape, body-scroll-lock, and overlay click-outside
 * (with mousedown-origin tracking so a text-selection
 * drag from inside the dialog doesn't close on release).
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

// Keep keyboard focus inside an open dialog: move focus in
// on open, wrap Tab/Shift-Tab at the boundaries, and
// restore focus to the previously-focused element on close.
// Without this the asserted aria-modal="true" lies to
// assistive tech, since Tab would walk into the still-live
// page behind the overlay.
function bindFocusTrap(
  host: HTMLElement, effect: Effect, opts: ModalChrome,
): void {
  let previouslyFocused: HTMLElement | null = null

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
    // Defer so the dialog body is mounted before the search
    // for an initial focus target.
    requestAnimationFrame(() => {
      if (!opts.isOpen()) return
      ;(focusableWithin(host)[0] ?? host).focus()
    })
    host.addEventListener('keydown', onKeydown)
    return () => {
      host.removeEventListener('keydown', onKeydown)
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
    document.body.classList.add('no-scroll')
    return () => document.body.classList.remove('no-scroll')
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
// Mirrors backend/utils/modal.js's chrome shape so the
// same CSS conventions apply across the codebase. The
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
