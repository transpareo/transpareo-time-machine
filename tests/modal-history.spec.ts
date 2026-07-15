// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Back-button dismissal wired by bindModalChrome: an open
 * modal keeps one extra history entry so the platform Back
 * gesture pops that entry and closes the dialog instead of
 * navigating the host page away, while Escape / click-out /
 * the close button pop the entry back off to keep the
 * history stack balanced. A modal that navigates as it
 * closes (a version row jumping into the timeline) buries
 * the entry, and the balance must leave it alone rather than
 * rewind that navigation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { bindModalChrome } from '../src/reactive/modal'
import { signal, effect, type Signal } from '../src/reactive/signals'

interface Bound {
  open: Signal<boolean | null>
  onClose: ReturnType<typeof vi.fn>
  dispose: () => void
}

// The balance pop is deferred to a microtask, so tests that
// close a modal by non-Back means flush the queue before
// asserting.
const flush = (): Promise<void> => new Promise((r) => queueMicrotask(r))

// Mirror the element's effect() shape: register each binding
// with the real signal engine so set() re-runs it, exactly
// like LightElement.effect does.
function bindModal(initial: boolean | null): Bound {
  const host = document.createElement('div')
  document.body.appendChild(host)

  const open = signal<boolean | null>(initial)
  const onClose = vi.fn(() => open.set(null))
  const disposers: Array<() => void> = []
  const register = (fn: () => void | (() => void)): void => {
    disposers.push(effect(fn))
  }

  bindModalChrome(host, register, {
    isOpen: () => open() != null && open() !== false,
    onClose,
  })

  return {
    open,
    onClose,
    dispose: () => {
      for (const d of disposers) d()
      host.remove()
    },
  }
}

describe('bindModalChrome back-button dismissal', () => {
  let pushState: ReturnType<typeof vi.spyOn>
  let back: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // pushState calls through so window.history.state carries
    // the modal marker the balance check reads; back is stubbed
    // so the assertion observes the intent without traversing.
    pushState = vi.spyOn(window.history, 'pushState')
    back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('pushes one history entry when the modal opens', () => {
    const m = bindModal(false)
    expect(pushState).not.toHaveBeenCalled()

    m.open.set(true)
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(pushState.mock.calls[0][0])
      .toMatchObject({ transpareoTimeMachineModal: true })
    expect(back).not.toHaveBeenCalled()

    m.dispose()
  })

  it('closes the modal on Back and does not pop again', async () => {
    const m = bindModal(true)

    window.dispatchEvent(new Event('popstate'))
    expect(m.onClose).toHaveBeenCalledTimes(1)
    expect(m.open()).toBe(null)
    await flush()
    // Back already discarded the entry, so no extra history.back.
    expect(back).not.toHaveBeenCalled()

    m.dispose()
  })

  it('pops the entry when closed by other means', async () => {
    const m = bindModal(true)

    // Escape / click-out / close button all funnel through the
    // open signal going falsy; the pushed entry must be popped
    // to keep the stack balanced.
    m.open.set(null)
    await flush()
    expect(back).toHaveBeenCalledTimes(1)

    m.dispose()
  })

  it('leaves the entry alone when the modal navigates on close', async () => {
    const m = bindModal(true)
    pushState.mockClear()

    // Mirror navigateToVersion: close, then synchronously push a
    // real navigation entry that buries the modal marker.
    m.open.set(null)
    window.history.pushState(null, '', '#evt-3')

    await flush()
    // The buried marker must be left in place so the navigation
    // stands; popping would rewind it.
    expect(back).not.toHaveBeenCalled()
    expect(window.history.state).toBe(null)

    m.dispose()
  })

  it('re-pushes on a second open after closing', async () => {
    const m = bindModal(false)
    m.open.set(true)
    m.open.set(null)
    await flush()
    pushState.mockClear()

    m.open.set(true)
    expect(pushState).toHaveBeenCalledTimes(1)

    m.dispose()
  })

  it('does not stack a second entry while staying open', () => {
    // openModal swapping one dialog for another keeps isOpen
    // truthy across the swap; the identity change re-runs the
    // effect but must not push another entry.
    const swap = signal<string | null>('a')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const disposers: Array<() => void> = []
    bindModalChrome(host, (fn) => disposers.push(effect(fn)), {
      isOpen: () => swap() != null,
      onClose: () => swap.set(null),
    })

    expect(pushState).toHaveBeenCalledTimes(1)
    swap.set('b')
    expect(pushState).toHaveBeenCalledTimes(1)
    expect(back).not.toHaveBeenCalled()

    for (const d of disposers) d()
    host.remove()
  })
})
