/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Two custom-element bases.
 *
 *   BaseElement , shadow root + style injection.
 *                  Used by the public outer wrapper, which
 *                  isolates the host page from our DOM and
 *                  loads the bundled stylesheet.
 *
 *   LightElement, no shadow, no styles. Used by every
 *                  inner component. They live inside the
 *                  outer shadow, so the wrapper's bundle
 *                  styles them by cascade. CSS class names
 *                  are the only link between TS and SCSS.
 */

import { effect } from './signals'

type Disposer = () => void

abstract class Reactive extends HTMLElement {
  protected disposers: Disposer[] = []
  protected mounted = false

  protected effect(fn: () => void | (() => void)): void {
    this.disposers.push(effect(fn))
  }

  protected runDisposers(): void {
    for (const d of this.disposers) {
      try { d() } catch (_) { /* noop */ }
    }
    this.disposers.length = 0
  }
}

export class LightElement extends Reactive {
  connectedCallback(): void {
    if (this.mounted) return
    this.mounted = true
    this.setup()
  }

  disconnectedCallback(): void {
    this.mounted = false
    this.runDisposers()
    this.replaceChildren()
  }

  protected setup(): void { /* override */ }
}

export class BaseElement extends Reactive {
  protected readonly root: ShadowRoot
  private readonly boxSizingReset: HTMLStyleElement

  constructor() {
    super()
    this.root = this.attachShadow({ mode: 'open' })

    // Document-level box-sizing reset doesn't cross the
    // shadow boundary; without this, padding + width:100%
    // overflows by 2*padding inside any shadow root.
    this.boxSizingReset = document.createElement('style')
    this.boxSizingReset.textContent =
      '*,*::before,*::after{box-sizing:border-box}'
    this.root.appendChild(this.boxSizingReset)
  }

  connectedCallback(): void {
    if (this.mounted) return
    this.mounted = true

    // disconnectedCallback clears the whole shadow root,
    // taking the constructor-injected reset with it; put
    // it back before setup() so a re-mounted element keeps
    // the box-sizing contract.
    if (!this.boxSizingReset.isConnected) {
      this.root.appendChild(this.boxSizingReset)
    }
    this.setup(this.root)
  }

  disconnectedCallback(): void {
    this.mounted = false
    this.runDisposers()
    this.root.replaceChildren()
  }

  protected addStyle(css: string): void {
    const style = document.createElement('style')
    style.textContent = css
    this.root.appendChild(style)
  }

  protected setup(_root: ShadowRoot): void { /* override */ }
}
