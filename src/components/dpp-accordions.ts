/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-accordions>, collapsible body-text panels for
 * care, disposal, repair, etc. Single-open: clicking an
 * item closes the previously-open one. Click handling is
 * delegated; each item carries its key on a data attr.
 */

import { LightElement } from '@/reactive/element'
import { signal } from '@/reactive/signals'
import { el } from '@/reactive/dom'
import { icon, iconForProperty } from '@/icons'
import { renderedPresentation } from '@/state'
import { i18n } from '@/i18n'
import {
  propertyIsKind, tx, type PropertyValueOf,
} from '@/types'

type LongText = PropertyValueOf<'longText'>

class DppAccordions extends LightElement {
  private openKey = signal<string | null>(null)

  protected setup(): void {
    const wrap = el('div', 'dpp-accordion')
    this.appendChild(wrap)

    wrap.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('[data-key]')
      if (!(item instanceof HTMLElement)) return
      const key = item.dataset.key!
      this.openKey.set(this.openKey.peek() === key ? null : key)
    })

    this.effect(() => {
      const rows = renderedPresentation().filter(propertyIsKind('longText'))
      const open = this.openKey()
      wrap.style.display = rows.length ? '' : 'none'
      wrap.replaceChildren(
        ...rows.map((row) => buildItem(row, open === row.key)),
      )
    })
  }
}

function buildItem(row: LongText, isOpen: boolean): HTMLElement {
  const cls = `dpp-accordion-item${isOpen ? ' open' : ''}`
  const it = el('div', cls)
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
