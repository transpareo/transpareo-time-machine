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

import type { LangText } from '@/types'

// Create an element with optional class, text and the
// language of that text. Pass undefined for any of the
// optional args to skip them.
//
//   const row = el('div', 'row')
//   const label = el('span', 'label', 'Origin')
//   const [name, lang] = txLang(row.name, i18n.locale)
//   const title = el('h3', 'title', name, lang)
//
// Shared namespace constant, kept here so consumers
// don't redeclare it in their own modules.
export const SVG_NS = 'http://www.w3.org/2000/svg'

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string, lang?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  if (lang) node.lang = lang
  return node
}

// A resolved value for a parent that holds other text too
// (an icon's label, a note, its neighbours in a list): a
// span declaring the value's language when it has one of
// its own, else the bare text.
export function phrase([text, lang]: LangText): string | HTMLSpanElement {
  return lang ? el('span', undefined, text, lang) : text
}

// Resolved values as one comma-separated run, each phrase
// in its own language.
export function appendPhrases(
  parent: Element, items: ReadonlyArray<LangText>,
): void {
  items.forEach((item, i) => {
    if (i) parent.append(', ')
    parent.append(phrase(item))
  })
}
