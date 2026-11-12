// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Keyboard focus in a dialog wired by bindModalChrome. The
 * dialog takes focus as it opens, without waiting for a
 * frame a busy page may hold back. A dialog redraws its
 * whole content when data lands (the library entry, a
 * version verdict), which detaches the control a keyboard
 * user is on; focus moves to the same control in the new
 * content instead of falling out of the dialog.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { bindModalChrome } from '../src/reactive/modal'
import { signal, effect } from '../src/reactive/signals'

const flush = (): Promise<void> => new Promise((r) => queueMicrotask(r))

let disposers: Array<() => void> = []

// A dialog the way the components build one: the chrome
// binds first, then an effect renders the content whenever
// the open signal or the data it reads changes.
function mountDialog(
  content: (data: string) => string, initialFocus?: 'host'
) {
  const opener = document.createElement('button')
  const host = document.createElement('div')
  document.body.append(opener, host)

  const open = signal(false)
  const data = signal('loading')
  const register = (fn: () => void | (() => void)): void => {
    disposers.push(effect(fn))
  }
  bindModalChrome(host, register, {
    isOpen: () => open(),
    onClose: () => open.set(false),
    initialFocus
  })
  register(() => {
    if (!open()) return host.replaceChildren()
    host.innerHTML = content(data())
  })
  disposers.push(() => host.remove(), () => opener.remove())
  return { opener, host, open, data }
}

function focused(): Element | null {
  return document.activeElement
}

afterEach(() => {
  for (const d of disposers) d()
  disposers = []
})

describe('bindModalChrome focus', () => {
  it('moves focus into the dialog before the next frame', async () => {
    const m = mountDialog(() => '<button class="close">x</button>')
    m.opener.focus()

    m.open.set(true)
    await flush()
    expect(focused()).toBe(m.host.querySelector('.close'))
  })

  // A viewer driven by arrow keys: a control focused on open
  // would ring at the first key press.
  it('takes focus on the dialog itself when asked to', async () => {
    const m = mountDialog(() => '<button class="close">x</button>', 'host')
    m.opener.focus()

    m.open.set(true)
    await flush()
    expect(focused()).toBe(m.host)
  })

  it('wraps Tab from the dialog itself into its controls', async () => {
    const m = mountDialog(() => `
      <button class="close">x</button>
      <button class="next">Next</button>
    `, 'host')
    m.open.set(true)
    await flush()
    const tab = (shiftKey: boolean): void => {
      const key = { key: 'Tab', shiftKey, bubbles: true }
      m.host.dispatchEvent(new KeyboardEvent('keydown', key))
    }

    tab(true)
    expect(focused()).toBe(m.host.querySelector('.next'))
    m.host.focus()
    tab(false)
    expect(focused()).toBe(m.host.querySelector('.close'))
  })

  it('keeps focus on the same control across a redraw', async () => {
    const m = mountDialog((data) => `
      <button class="close">x</button>
      <p>${data}</p>
      <button class="download">Download</button>
    `)
    m.open.set(true)
    await flush()
    m.host.querySelector<HTMLElement>('.download')!.focus()

    m.data.set('ready')
    await flush()
    const download = m.host.querySelector('.download')
    expect(m.host.querySelector('p')!.textContent).toBe('ready')
    expect(focused()).toBe(download)
  })

  it('tells apart controls that share a name', async () => {
    const m = mountDialog((data) => `
      <button class="close">x</button>
      <a href="#a" class="key">did-web</a>
      <a href="#b" class="key">did-web</a>
      <p>${data}</p>
    `)
    m.open.set(true)
    await flush()
    m.host.querySelectorAll<HTMLElement>('.key')[1].focus()

    m.data.set('ready')
    await flush()
    expect(focused()).toBe(m.host.querySelectorAll('.key')[1])
  })

  it('falls back to the first control when its own is gone', async () => {
    const m = mountDialog((data) => `
      <button class="close">x</button>
      ${data === 'loading' ? '<button class="retry">Retry</button>' : ''}
    `)
    m.open.set(true)
    await flush()
    m.host.querySelector<HTMLElement>('.retry')!.focus()

    m.data.set('ready')
    await flush()
    expect(focused()).toBe(m.host.querySelector('.close'))
  })

  it('hands focus back to the opener on close', async () => {
    const m = mountDialog(() => '<button class="close">x</button>')
    m.opener.focus()
    m.open.set(true)
    await flush()

    m.open.set(false)
    await flush()
    expect(focused()).toBe(m.opener)
  })

  it('leaves focus alone that is elsewhere on the page', async () => {
    const m = mountDialog((data) => `<button>${data}</button>`)
    m.open.set(true)
    await flush()
    m.opener.focus()

    m.data.set('ready')
    await flush()
    expect(focused()).toBe(m.opener)
  })
})
