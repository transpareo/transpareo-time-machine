/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Hand-written public API declarations. The package's
 * entries are side-effect imports that register custom
 * elements; consumers never import runtime symbols, so
 * generated declarations for the internal module graph
 * would add a build dependency for no consumer value.
 * Everything a TypeScript host page can actually touch is
 * declared here: the two element interfaces, the tag-name
 * registrations (typed querySelector/createElement), the
 * `:state` event payload, and the openModal contract.
 * Keep this file in sync with the README's "Public API"
 * section; `npm run check` compiles it.
 */

/** Options for `TranspareoTimeMachineElement.openModal`. */
export interface ModalOpenOptions {
  readonly title: string | Node

  /** A string body is set as textContent (escaped), never
   *  parsed as HTML; pass a Node/DocumentFragment for
   *  markup. */
  readonly body: string | HTMLElement | DocumentFragment

  /** Also fires on Escape, click-outside, and the X
   *  button. */
  readonly onClose?: () => void
}

export interface ModalHandle {
  close(): void
}

/** Detail of the `transpareo-time-machine:state` event,
 *  fired on the element (it does not bubble) once on first
 *  'ready' and again whenever the active version, locale,
 *  or manifest changes. */
export interface TimeMachineStateDetail {
  readonly code: string
  readonly locale: string
  readonly version: number
  readonly currentVersion: number
  readonly manifestUrl: string
}

/** The full passport renderer, `<transpareo-time-machine>`.
 *  Configured via attributes (src, icons-src,
 *  pinned-platform-key, pinned-issuer-key,
 *  revoked-roots-src, show-verification-mark, verifier,
 *  footer-copyright, footer-links); see the README's
 *  "Public API" section. */
export interface TranspareoTimeMachineElement extends HTMLElement {
  openModal(options: ModalOpenOptions): ModalHandle
}

/** The standalone verification widget, `<dpp-verifier>`.
 *  Configured via attributes (src, pinned-platform-key);
 *  no public methods or properties beyond HTMLElement. */
export type DppVerifierElement = HTMLElement

declare global {
  interface HTMLElementTagNameMap {
    'transpareo-time-machine': TranspareoTimeMachineElement
    'dpp-verifier': DppVerifierElement
  }

  interface HTMLElementEventMap {
    'transpareo-time-machine:state': CustomEvent<TimeMachineStateDetail>
  }
}
