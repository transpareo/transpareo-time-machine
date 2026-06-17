/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Imperative DOM helpers. Components that rebuild a whole
 * subtree on each signal change (the timeline rows, the
 * deck cards, the modal bodies) build their DOM inside a
 * `this.effect()` block and use these helpers to keep the
 * builder code shallow.
 *
 * The counterpart to this module is ./html.ts, which
 * provides a tagged-template runtime for the inverse case:
 * mostly-static structure with several small reactive
 * bindings (each `${fn}` updates one node/attribute on its
 * own, so the whole tree does not get rebuilt). Reach for
 * `html` when the structure is stable and the work is in
 * the bindings, reach for `el()` when the structure itself
 * changes shape between renders.
 */

// Create an element with optional class and text. Pass
// undefined for any of the optional args to skip them.
//
//   const row = el('div', 'row')
//   const label = el('span', 'label', 'Origin')
//
// Shared namespace constant, kept here so consumers
// don't redeclare it in their own modules.
export const SVG_NS = 'http://www.w3.org/2000/svg'

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
