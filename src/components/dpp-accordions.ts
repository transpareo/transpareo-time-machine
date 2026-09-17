/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-accordions>, collapsible body-text panels for
 * care, disposal, repair, etc. Each section opens and
 * closes on its own and stays open until its header is
 * clicked again. Click handling is delegated; each item
 * carries its key on a data attr.
 *
 * A toggle rebuilds the clicked item alone: the fresh
 * node plays the entrance animation, while the sections
 * open around it hold the body they are showing.
 * Rebuilding the whole list is the effect's job, and it
 * runs when the rows or the locale change.
 */

import { LightElement } from '@/reactive/element'
import { el } from '@/reactive/dom'
import { icon, iconForProperty } from '@/icons'
import { renderedPresentation } from '@/state'
import { i18n } from '@/i18n'
import {
  propertyIsKind, tx, type PropertyValueOf,
} from '@/types'

type LongText = PropertyValueOf<'longText'>

class DppAccordions extends LightElement {
  // Every section the reader has opened. The click
  // handler is its only writer and renders its own item;
  // the effect reads it to restore the sections whenever
  // it rebuilds the list. Nothing reads it reactively, so
  // a plain Set carries it.
  private open = new Set<string>()

  protected setup(): void {
    const wrap = el('div', 'dpp-accordion')
    this.appendChild(wrap)

    wrap.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('[data-key]')
      if (!(item instanceof HTMLElement)) return
      const key = item.dataset.key!
      const row = longTextRows().find((r) => r.key === key)
      if (!row) return

      const isOpen = !this.open.has(key)
      if (isOpen) this.open.add(key)
      else this.open.delete(key)

      // The entrance marker belongs to one item at a
      // time; the toggle before this one has finished
      // moving.
      wrap.querySelector('.opening')?.classList.remove('opening')
      swapItem(item, buildItem(row, isOpen, true))
    })

    this.effect(() => {
      const rows = longTextRows()
      wrap.style.display = rows.length ? '' : 'none'
      wrap.replaceChildren(
        ...rows.map((row) => buildItem(row, this.open.has(row.key)))
      )
    })
  }
}

function longTextRows(): LongText[] {
  return renderedPresentation().filter(propertyIsKind('longText'))
}

// Put a rebuilt item in place of the one just toggled,
// keeping the keyboard on the header that leaves with the
// old node. Inside a shadow root document.activeElement
// names the host, so the focus is read off the root node.
function swapItem(old: HTMLElement, next: HTMLElement): void {
  const root = old.getRootNode() as Document | ShadowRoot
  const focused = old.contains(root.activeElement)
  old.replaceWith(next)
  if (focused) next.querySelector('button')?.focus()
}

// `opening` marks the item a click just built, which is
// the one whose entrance motion the reader asked for. A
// version or locale switch rebuilds the list without it,
// so the sections it finds open are open from the first
// frame (dpp.scss).
function buildItem(
  row: LongText, isOpen: boolean, opening = false
): HTMLElement {
  const state = (isOpen ? ' open' : '') + (opening ? ' opening' : '')
  const it = el('div', `dpp-accordion-item${state}`)
  it.dataset.key = row.key
  it.appendChild(buildHeader(row, isOpen))

  if (isOpen) {
    const body = tx(row.value.body, i18n.locale)
    const bodyEl = el('div', 'dpp-accordion-body')

    // Inner wrapper so the expand animation can clip the
    // content while the body's grid row grows (dpp.scss).
    const inner = el('div', 'dpp-accordion-body-inner')
    appendLinkified(inner, body)
    bodyEl.appendChild(inner)
    it.appendChild(bodyEl)
  }
  return it
}

// Match bare or absolute URLs in body text. We keep the
// pattern conservative: at least one dot-separated label
// followed by a 2+-letter TLD, plus an optional path that
// can't include whitespace or a closing paren (so a URL
// inside parens stops before the `)`). Version strings
// like `v1.4.2` and abbreviations like `e.g.` fail the
// `[a-z]{2,}` TLD requirement and are left alone.
const URL_RE =
  /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?/gi

function appendLinkified(parent: Element, text: string): void {
  URL_RE.lastIndex = 0
  let last = 0
  let m: RegExpExecArray | null
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) {
      parent.appendChild(
        document.createTextNode(text.slice(last, m.index)),
      )
    }
    parent.appendChild(buildExtLink(m[0]))
    last = URL_RE.lastIndex
  }
  if (last < text.length) {
    parent.appendChild(document.createTextNode(text.slice(last)))
  }
}

function buildExtLink(display: string): HTMLAnchorElement {
  const href = /^https?:/i.test(display)
    ? display
    : `https://${display}`
  const a = el('a', 'dpp-ext-link', display)
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.append(' ', icon('link-ext'))
  return a
}

function buildHeader(
  row: LongText, isOpen: boolean,
): HTMLButtonElement {
  const header = el('button', 'dpp-accordion-header')
  header.type = 'button'
  header.setAttribute('aria-expanded', String(isOpen))

  const left = el('span')
  const iconId = iconForProperty(row.key)
  if (iconId) {
    left.appendChild(icon(iconId))
    left.append(' ')
  }
  left.append(tx(row.name, i18n.locale))

  // Open/close toggle: the x glyph, rotated 45° by the
  // stylesheet while the section is closed so it reads as
  // "+"; the open section shows it regular, as "close".
  const toggle = icon('cancel')
  toggle.classList.add('dpp-accordion-toggle')
  header.append(left, toggle)
  return header
}

customElements.define('dpp-accordions', DppAccordions)
