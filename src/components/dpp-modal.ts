/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-modal>, the generic modal host that backs the
 * `tm.openModal(...)` public method on the
 * <transpareo-time-machine> custom element. Lives in
 * the SPA's shadow tree so the existing
 * .modal / .modal-header / .modal-body / .modal-close
 * styles reach the rendered dialog without a separate
 * stylesheet injection.
 *
 * One modal at a time: a second openModal call replaces
 * the first and fires the previous handle's onClose so
 * the integration knows its modal got displaced.
 *
 * Why a custom element instead of dynamically appending
 * an overlay div on each openModal call: the existing
 * bindModalChrome helper wires Escape / body-scroll-lock
 * / click-outside via the host's effect scope, which is
 * tied to a connected custom element. Reusing that
 * machinery from a one-off div would require
 * reinventing the disposer wiring and would leak
 * document-level listeners on misuse. Persistent
 * element, signal-driven content, no leaks.
 */

import { LightElement } from '@/reactive/element'
import { signal } from '@/reactive/signals'
import { bindModalChrome, buildModal } from '@/reactive/modal'

export interface ModalOpenOptions {
  readonly title: string | Node

  // A string body is set as textContent (escaped), never
  // parsed as HTML; pass a Node/DocumentFragment for markup.
  readonly body: string | HTMLElement | DocumentFragment
  readonly onClose?: () => void
}

export interface ModalHandle {
  close(): void
}

interface ActiveModal {
  readonly title: string | Node
  readonly body: string | HTMLElement | DocumentFragment
  readonly close: () => void
}

const active = signal<ActiveModal | null>(null)

// Open a modal from caller code. Returns a handle whose
// .close() dismisses it and fires onClose; calling
// close() more than once is a no-op. A second openModal
// call before the first is closed dismisses the first
// (its onClose fires) and replaces it.
//
// Safe to call before <dpp-modal> has mounted: the
// signal is set immediately, and dpp-modal renders the
// queued entry as soon as its setup() runs after
// mountReady(). The natural call site (a listener of
// the `transpareo-time-machine:state` event) only fires
// after mount, so this queueing window is rarely
// exercised in practice but stays well-defined.
export function openModal(opts: ModalOpenOptions): ModalHandle {
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true

    // Only clear the signal if WE are still the active
    // modal; otherwise a successor took over and
    // clearing would dismiss them too.
    if (active.peek() === entry) active.set(null)
    if (opts.onClose) opts.onClose()
  }
  const entry: ActiveModal = {
    title: opts.title,
    body: opts.body,
    close,
  }
  const prev = active.peek()

  // Swap active to the new entry first so prev.close()'s
  // "am I still active?" check sees a different entry
  // and skips the signal clear. Without this ordering
  // the dpp-modal effect would fire twice (hide, show)
  // and the user would see a flicker between modals.
  active.set(entry)
  if (prev) prev.close()
  return { close }
}

class DppModal extends LightElement {
  protected setup(): void {
    this.className = 'dpp-modal-overlay'
    this.style.display = 'none'

    bindModalChrome(this, this.effect.bind(this), {
      isOpen: () => active() != null,
      onClose: () => {
        const cur = active.peek()
        if (cur) cur.close()
      },
    })

    this.effect(() => {
      const cur = active()
      if (!cur) {
        this.style.display = 'none'
        this.replaceChildren()
        return
      }
      this.style.display = ''
      this.replaceChildren(buildModal({
        title: cur.title,
        body: cur.body,
        onClose: cur.close,
      }))
    })
  }
}

customElements.define('dpp-modal', DppModal)
