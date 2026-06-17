/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <transpareo-time-machine>, public root element. The
 * one and only shadow boundary in the project: it
 * isolates the host page's CSS from our internals
 * while leaving inner components free to be plain
 * light-DOM elements styled by the bundled stylesheet.
 *
 * The host page embeds the element with a `src`
 * attribute pointing at a published DPP manifest URL:
 *
 *   <transpareo-time-machine
 *     src="https://cdn.example.com/<id>/dpp/<code>/manifest.json">
 *   </transpareo-time-machine>
 *
 * On connect, the element kicks off the host module's
 * fetch flow (manifest -> current snapshot + events
 * sidecar + EPCIS doc). The inner SPA tree only mounts
 * once `host.loadState === 'ready'`, so every child
 * component sees non-null data when its setup runs.
 *
 * Side-effect imports register every dpp-* sub-element
 * via customElements.define inside each module.
 */

import { BaseElement } from '@/reactive/element'
import { html } from '@/reactive/html'
import { effect } from '@/reactive/signals'
import {
  activeVersionNumber, isOnCurrent, resetBootState,
} from '@/state'
import * as host from '@/host'
import { i18n } from '@/i18n'
import { t } from '@/i18n/labels'
import { bootstrapVerify, bootstrapHash } from '@/bootstrap'
import { ensureEventsVerified, resetVerifyCaches } from '@/actions'
import {
  bootstrapPrivateRowsFetch, resetPrivateState,
} from '@/private-properties'
import {
  openModal as openGenericModal,
  type ModalHandle,
  type ModalOpenOptions,
} from '@/components/dpp-modal'
import { config, initConfigFromElement } from '@/config'
import { installIcons } from '@/icons'

import './dpp-verifier'
import './dpp-brandbar'
import './dpp-hero'
import './dpp-timeline'
import './dpp-deck'
import './dpp-property-cards'
import './dpp-properties'
import './dpp-badge-lists'
import './dpp-manufacturer'
import './dpp-accordions'
import './dpp-composition-donut'
import './dpp-compositions'
import './dpp-verification-modal'
import './dpp-event-modal'
import './dpp-library-modal'
import './dpp-auth-modal'
import './dpp-modal'
import './dpp-lightbox'
import './dpp-footer'

import css from '@/styles/transpareo-time-machine.scss?inline'

class TranspareoTimeMachine extends BaseElement {
  static get observedAttributes(): string[] {
    return ['src']
  }

  // Set once setup() has applied config from the element's
  // attributes. Gates attributeChangedCallback so the
  // initial src boots from setup() (after config is read),
  // not from the upgrade-time attribute callback.
  private configured = false

  // Public modal API. Integrations (leadgen overlay,
  // recall banner) call this from a `:state` event
  // listener to open a modal styled with the same
  // chrome as the SPA's own modals. Returns a handle
  // for programmatic dismissal; the caller's onClose
  // also fires on Escape / click-outside / X button.
  // A second openModal call before the first is closed
  // dismisses the first (its onClose fires) and
  // replaces it; at most one generic modal is visible
  // at a time. Safe to call before <dpp-modal> has
  // mounted: the request is queued in the module
  // signal and renders as soon as the element
  // subscribes.
  openModal(opts: ModalOpenOptions): ModalHandle {
    return openGenericModal(opts)
  }

  attributeChangedCallback(
    name: string, _old: string | null, value: string | null,
  ): void {
    // The initial src is booted by setup() once config is
    // applied; only react to later src changes here.
    if (!this.configured || config.verifier) return
    if (name === 'src' && value && this.isConnected) {
      // A later `src` is a full reboot. Clear every
      // per-boot cache first so the previous DPP's
      // verdicts, rows, and gesture state can't bleed
      // into the new one; bootFrom clears the host-side
      // artefact caches and bumps the boot epoch that
      // in-flight async work checks before writing.
      resetBootState()
      resetVerifyCaches()
      resetPrivateState()
      void host.bootFrom(value)
    }
  }

  protected setup(root: ShadowRoot): void {
    // Read host config off this element's attributes before
    // anything below reads it (installIcons, verifier mode,
    // the mounted subtree).
    initConfigFromElement(this)
    this.configured = true

    this.addStyle(css)

    // Functional icons ship inline; the decorative content
    // sprite is fetched when configured. Both inject into
    // this shadow root so bare `#id` <use> refs resolve.
    installIcons(root, this)

    // Dedicated container for the dynamic content so the
    // <style> element stays put when we swap from the
    // loading shell to the mounted SPA tree.
    const container = document.createElement('div')
    container.className = 'tm-content'
    root.appendChild(container)

    // Standalone verifier-mode. The backend's verifier
    // shell route serves no `src` and sets the `verifier`
    // attribute, so there is no manifest to fetch. We mount
    // the <dpp-verifier> widget inline instead, propagating
    // the same pinned platform keys the chip would use
    // (no issuer pin: the widget verifies foreign DPPs).
    if (config.verifier) {
      const widget = document.createElement('dpp-verifier')
      if (config.pinnedPlatformKeys?.length) {
        widget.setAttribute(
          'pinned-platform-key', config.pinnedPlatformKeys.join(' '),
        )
      }
      container.appendChild(widget)
      return
    }

    // Integrator hint, not a visitor-facing signal: an
    // unpinned embed's chip proves internal consistency of
    // the fetched artefacts, not their origin. One console
    // line so the developer wiring the embed learns that
    // where they look (see the README's trust section).
    if (!config.pinnedPlatformKeys?.length) {
      // Deliberate info-level integrator hint; warn would
      // overstate it.
      // eslint-disable-next-line no-console
      console.info(
        '[transpareo-time-machine] no pinned-platform-key '
        + 'configured: the verification verdict is advisory '
        + '(internal consistency, not origin). See the README '
        + 'on pinning.',
      )
    }

    const src = this.getAttribute('src')
    if (src) void host.bootFrom(src)

    // The inner SPA tree is mounted reactively so it
    // only renders once the host has data. Before that
    // (and again while a later `src` reboots) the element
    // shows a minimal "verifying" surface that the
    // issuer's stylesheet can theme. Every transition
    // into 'ready' mounts a fresh tree; the previous
    // tree's bindings are disposed first so they stop
    // writing to detached nodes.
    this.effect(() => {
      const state = host.loadState()
      if (state === 'ready') {
        this.dropTree()
        container.replaceChildren()
        this.mountReady(container)
      } else {
        container.replaceChildren(
          buildLoadingShell(state, host.loadError()),
        )
      }
    })

    // Public state event for integrations that slot
    // content above <dpp-compositions>. Fires once on
    // first 'ready', then again whenever the active
    // version, the active locale, or the manifest
    // changes. Consumers listen on this element
    // directly; the event does not bubble. The detail
    // is intentionally small (no snapshot content) so
    // marketing / overlay JS reads the DPP identity and
    // either fetches its own per-DPP config or decides
    // not to render.
    this.effect(() => {
      const state = host.loadState()
      const m = host.manifest()
      if (state !== 'ready' || !m) return
      this.dispatchEvent(new CustomEvent('transpareo-time-machine:state', {
        detail: {
          code: m.code,
          locale: i18n.locale,
          version: activeVersionNumber(),
          currentVersion: m.currentVersion,
          manifestUrl: host.getManifestUrl() ?? '',
        },
      }))
    })
  }

  // Bindings of the currently-mounted SPA tree, kept apart
  // from the element-lifetime disposers so a reboot can
  // drop just the tree's effects and mount a fresh one.
  private treeDisposers: Array<() => void> = []

  private registerTreeEffect = (
    fn: () => void | (() => void),
  ): void => {
    this.treeDisposers.push(effect(fn))
  }

  private dropTree(): void {
    for (const d of this.treeDisposers) {
      try { d() } catch (_) { /* noop */ }
    }
    this.treeDisposers.length = 0
  }

  disconnectedCallback(): void {
    this.dropTree()
    super.disconnectedCallback()
  }

  private mountReady(container: HTMLElement): void {
    bootstrapVerify()
    bootstrapHash()
    bootstrapPrivateRowsFetch()
    ensureEventsVerified()
    const tpl = html`
      <main class=${() => `stage${isOnCurrent() ? '' : ' scrubbing'}`}>
        <dpp-timeline></dpp-timeline>
        <dpp-deck>
          <article class="card">
            <dpp-brandbar></dpp-brandbar>
            <div class="card-content">
              <dpp-hero></dpp-hero>
              <slot name="additional" ?hidden=${() => !isOnCurrent()}></slot>
              <dpp-compositions></dpp-compositions>
              <dpp-property-cards></dpp-property-cards>
              <dpp-properties></dpp-properties>
              <dpp-badge-lists></dpp-badge-lists>
              <dpp-accordions></dpp-accordions>
            </div>
          </article>
        </dpp-deck>
        <dpp-footer></dpp-footer>
        <dpp-verification-modal></dpp-verification-modal>
        <dpp-event-modal></dpp-event-modal>
        <dpp-library-modal></dpp-library-modal>
        <dpp-auth-modal></dpp-auth-modal>
        <dpp-modal></dpp-modal>
        <dpp-lightbox></dpp-lightbox>
      </main>
    `
    tpl.mount(container, this.registerTreeEffect)
  }
}

// Pre-mount surface. For loading/idle we render a
// <slot>, which exposes the host-page's light-DOM
// fallback (the boot spinner) through the shadow
// boundary. The light-DOM spinner is the SAME element
// that was visible before the custom element upgraded,
// so there's no visual swap as JS takes over. For
// error we render text inside the shell.
function buildLoadingShell(
  state: host.LoadState, err: string | null,
): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = `boot-shell boot-shell-${state}`
  if (state === 'retired') {
    const heading = document.createElement('p')
    heading.className = 'boot-shell-heading'
    heading.textContent = t(i18n.labels, 'boot.retired')
    const detail = document.createElement('p')
    detail.className = 'boot-shell-detail'
    detail.textContent = t(i18n.labels, 'boot.retiredDetail')
    wrap.append(heading, detail)
  } else if (state === 'error') {
    wrap.textContent = err
      ? t(i18n.labels, 'boot.loadError', { message: err })
      : t(i18n.labels, 'boot.loadErrorGeneric')
  } else {
    wrap.appendChild(document.createElement('slot'))
  }
  return wrap
}

customElements.define('transpareo-time-machine', TranspareoTimeMachine)
