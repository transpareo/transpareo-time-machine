/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-footer>, copyright + host links on the left,
 * locale picker on the right. Picker rows lead with what
 * the viewer's current locale calls each language, keep
 * the native name as a right-hand hint, and persist the
 * choice via pickLocale().
 */

import { LightElement } from '@/reactive/element'
import { signal } from '@/reactive/signals'
import { el } from '@/reactive/dom'
import { availableLocales } from '@/state'
import {
  i18n, locale, localizedName, nativeName, nativeNameOrNull, pickLocale,
} from '@/i18n'
import { t } from '@/i18n/labels'
import { config, hasFooter } from '@/config'
import { safeLinkHref } from '@/safe-url'

// Above this many available locales the menu shows a
// filter input so the visitor can type-ahead instead of
// scrolling, useful when the full EU24 + non-EU set
// (32 locales today) is shipped.
const FILTER_THRESHOLD = 7

class DppFooter extends LightElement {
  private open = signal(false)

  protected setup(): void {
    const locales = availableLocales()
    const showPicker = locales.length > 1
    if (!hasFooter() && !showPicker) return

    this.innerHTML = `
      <footer class="footer">
        <span class="footer-left"></span>
        ${showPicker ? '<div class="locale-wrap"></div>' : ''}
      </footer>
    `

    if (hasFooter()) this.fillLeft()
    if (showPicker) this.bindPicker(locales)
  }

  private fillLeft(): void {
    const left = this.querySelector('.footer-left')!
    const cfg = config.footer ?? {}

    if (cfg.copyright) {
      left.appendChild(el('span', undefined, cfg.copyright))
    }

    for (const link of cfg.links ?? []) {
      // Backend ships `url`; the hand-written dev shells
      // and older embed snippets shipped `href`. Either
      // is accepted; missing both, or a script-bearing
      // scheme (the config rides in tamperable backend
      // data), skips the entry (better than rendering a
      // dead anchor).
      const target = safeLinkHref(link.url ?? link.href ?? '')
      if (!target) continue
      if (left.children.length) {
        left.appendChild(el('span', 'sep', '·'))
      }
      const a = el('a', undefined, link.label)
      a.href = target
      left.appendChild(a)
    }
  }

  private bindPicker(locales: ReadonlyArray<string>): void {
    const refs = this.buildPickerMarkup(locales)
    this.bindPickerInteractions(refs)
    this.bindPickerKeyboard(refs)
    this.bindPickerSync(refs, locales)
  }

  // Fill the .locale-wrap with the button + menu shell
  // and return the live DOM refs. Filter input is null
  // when the locale list is below the type-ahead
  // threshold; downstream branches on its absence.
  private buildPickerMarkup(
    locales: ReadonlyArray<string>,
  ): PickerRefs {
    const wrap = this.querySelector('.locale-wrap')!
    const withFilter = locales.length > FILTER_THRESHOLD
    wrap.innerHTML = `
      <button type="button" class="locale-switch" aria-haspopup="listbox">
        <span class="locale-label"></span>
        <span class="chevron" aria-hidden="true"></span>
      </button>
      <div class="locale-menu">
        ${withFilter ? '<input type="search" class="locale-filter" />' : ''}
        <ul class="locale-list" role="listbox"></ul>
        <div class="locale-empty" hidden></div>
      </div>
    `
    // Set label text through the DOM rather than
    // interpolating it into the markup, so a translation
    // containing a quote or angle bracket can't break the
    // attribute or inject into the menu.
    const filterInput =
      wrap.querySelector<HTMLInputElement>('.locale-filter')
    if (filterInput) {
      const filterLabel = t(i18n.labels, 'locale.filter')
      filterInput.setAttribute('aria-label', filterLabel)
      filterInput.placeholder = filterLabel

      // A control with neither id nor name draws a console
      // warning in Blink and is a field the browser offers
      // to autofill from unrelated history. An id answers
      // both and is scoped to this shadow root; a name would
      // only claim form semantics this input does not have,
      // since it is submitted with nothing.
      filterInput.id = 'locale-filter'
      filterInput.autocomplete = 'off'
    }
    const emptyEl = wrap.querySelector('.locale-empty') as HTMLElement
    emptyEl.textContent = t(i18n.labels, 'locale.noMatches')

    return {
      wrap: wrap as HTMLElement,
      btn: wrap.querySelector('.locale-switch') as HTMLButtonElement,
      lbl: wrap.querySelector('.locale-label') as HTMLElement,
      menu: wrap.querySelector('.locale-menu') as HTMLElement,
      list: wrap.querySelector('.locale-list') as HTMLElement,
      emptyEl,
      filterInput,
    }
  }

  // Click handlers: toggle button, locale selection,
  // filter typing, outside-click dismissal. Listens in
  // the capture phase so stop-propagation by sibling
  // handlers (timeline toggle, dot buttons, etc.)
  // doesn't keep the menu open.
  private bindPickerInteractions(refs: PickerRefs): void {
    refs.btn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.open.set(!this.open.peek())
    })

    refs.menu.addEventListener('click', (e) => {
      // Option buttons hold name spans, so the click target
      // may be a span; resolve to the code-bearing button.
      const btn = (e.target as HTMLElement).closest('[data-code]')
      const code = (btn as HTMLElement | null)?.dataset.code
      if (!code) return
      pickLocale(code)
      this.open.set(false)
    })

    refs.filterInput?.addEventListener('input', () => {
      applyFilter(refs, refs.filterInput!.value)
    })

    const onDocClick = (e: Event): void => {
      if (!this.open.peek()) return
      if (e.composedPath().includes(refs.wrap)) return
      this.open.set(false)
    }
    document.addEventListener('click', onDocClick, true)
    this.effect(() => () => {
      document.removeEventListener('click', onDocClick, true)
    })
  }

  // Escape closes the menu; arrows move focus through
  // the filtered list; Enter on the filter input
  // commits the first remaining match. Enter on a
  // focused option button fires its native click and
  // needs no extra handling.
  private bindPickerKeyboard(refs: PickerRefs): void {
    const root = this.getRootNode() as Document | ShadowRoot
    refs.menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        this.open.set(false)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveFocus(refs, root, 1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveFocus(refs, root, -1)
        return
      }
      if (e.key === 'Enter' && e.target === refs.filterInput) {
        e.preventDefault()
        visibleButtons(refs)[0]?.click()
      }
    })
  }

  // Reactive sync: keep the trigger label, aria-expanded,
  // menu visibility, and inner option list in sync with
  // the current locale + open signal. Reading i18n.labels
  // here subscribes the effect to locale-change
  // re-renders so the picker's own strings (filter
  // placeholder + empty-state) stay localised.
  private bindPickerSync(
    refs: PickerRefs, locales: ReadonlyArray<string>,
  ): void {
    this.effect(() => {
      const cur = locale()
      const labels = i18n.labels
      const isOpen = this.open()
      refs.lbl.textContent = nativeName(cur)
      refs.btn.setAttribute('aria-expanded', String(isOpen))
      refs.menu.style.display = isOpen ? '' : 'none'
      if (refs.filterInput) {
        const fl = t(labels, 'locale.filter')
        refs.filterInput.placeholder = fl
        refs.filterInput.setAttribute('aria-label', fl)
      }
      refs.emptyEl.textContent = t(labels, 'locale.noMatches')
      if (!isOpen) {
        refs.list.innerHTML = ''
        return
      }
      refs.list.replaceChildren(
        ...sortForViewer(locales, cur).map((code) => localeOption(code, cur)),
      )
      if (refs.filterInput) {
        refs.filterInput.value = ''
        applyFilter(refs, '')

        // Defer focus until after the menu becomes
        // visible; focus() on a display:none element
        // is a no-op in some browsers.
        requestAnimationFrame(() => refs.filterInput!.focus())
      }

      // Centre the active row when the list scrolls so
      // the visitor lands looking at their current
      // language, not the alphabetical top.
      refs.list.querySelector<HTMLButtonElement>('button.active')
        ?.scrollIntoView({ block: 'center' })
    })
  }
}

interface PickerRefs {
  readonly wrap: HTMLElement
  readonly btn: HTMLButtonElement
  readonly lbl: HTMLElement
  readonly menu: HTMLElement
  readonly list: HTMLElement
  readonly emptyEl: HTMLElement
  readonly filterInput: HTMLInputElement | null
}

// Hide list items whose visible names / code don't
// contain the typed query. Matching on the row's text
// covers both the leading viewer-locale name and the
// native hint, so "deutsch" still finds German while
// browsing in English. No re-render so the filter input
// keeps focus + caret position. When the filter excludes
// every option we surface the "no matches" line; clearing
// the filter hides it again.
function applyFilter(refs: PickerRefs, query: string): void {
  const q = query.trim().toLowerCase()
  let visible = 0
  for (const li of Array.from(refs.list.children) as HTMLElement[]) {
    const code = (li.firstElementChild as HTMLElement).dataset.code!
    const matches = !q
      || (li.textContent ?? '').toLowerCase().includes(q)
      || code.toLowerCase().includes(q)
    li.style.display = matches ? '' : 'none'
    if (matches) visible++
  }
  refs.emptyEl.hidden = visible > 0
}

function visibleButtons(refs: PickerRefs): HTMLButtonElement[] {
  return Array.from(refs.list.querySelectorAll<HTMLButtonElement>(
    'li:not([style*="none"]) button',
  ))
}

// Move keyboard focus through the filtered list.
// ArrowDown from the filter input lands on the first
// match; ArrowUp on the first match returns to the
// filter so the typist can keep refining without
// reaching for the mouse. Look up activeElement on the
// component's own root - document.activeElement
// returns the outer shadow host when the footer
// renders inside one.
function moveFocus(
  refs: PickerRefs,
  root: Document | ShadowRoot,
  delta: 1 | -1,
): void {
  const items = visibleButtons(refs)
  if (items.length === 0) return
  const focused = root.activeElement as HTMLElement | null
  const idx = focused instanceof HTMLButtonElement
    ? items.indexOf(focused)
    : -1
  if (delta === 1) {
    const next = idx === -1 ? 0 : Math.min(idx + 1, items.length - 1)
    items[next].focus()
    return
  }
  if (idx <= 0) {
    if (refs.filterInput) refs.filterInput.focus()
    else items[items.length - 1].focus()
    return
  }
  items[idx - 1].focus()
}

// Alphabetise by each row's leading name: what the
// viewer's locale calls the language, falling back to the
// native name where the two coincide or no localized name
// resolves. Runs per menu render (not once) because the
// leading names change with every locale switch. The
// viewer tag rides in untrusted manifest data, so an
// unparseable one falls back to the browser default
// collation instead of throwing.
function sortForViewer(
  locales: ReadonlyArray<string>, viewer: string,
): ReadonlyArray<string> {
  let collator: Intl.Collator
  try {
    collator = new Intl.Collator(viewer, { sensitivity: 'base' })
  } catch {
    collator = new Intl.Collator(undefined, { sensitivity: 'base' })
  }
  return locales
    .map((code) => ({
      code, label: localizedName(code, viewer) ?? nativeName(code),
    }))
    .sort((a, b) => collator.compare(a.label, b.label))
    .map((entry) => entry.code)
}

// Built as DOM rather than an innerHTML string: `code`
// comes from the manifest's availableLocales and is
// untrusted, so it is set via dataset/textContent where
// the browser escapes it, never interpolated into markup.
// Each row leads with what the viewer's current locale
// calls the language ("German" while browsing in English)
// and carries the native name ("Deutsch") as the
// right-hand hint; when the two coincide, or no localized
// name resolves, the native name stands alone.
//
// The hint is only ever a real native name. A locale we
// ship no name for falls back to its uppercased code, and
// "PT-BR" beside "Brazilian Portuguese" reads as data
// leaking into the UI, not as a language.
function localeOption(code: string, current: string): HTMLLIElement {
  const li = el('li')
  const active = code === current
  const btn = el('button', active ? 'active' : undefined)
  btn.type = 'button'
  btn.setAttribute('role', 'option')
  btn.dataset.code = code
  btn.setAttribute('aria-selected', String(active))
  const localized = localizedName(code, current)
  const native = nativeNameOrNull(code)
  btn.appendChild(el('span', undefined, localized ?? nativeName(code)))
  if (localized && native) {
    btn.appendChild(el('span', 'locale-hint', native))
  }
  li.appendChild(btn)
  return li
}

customElements.define('dpp-footer', DppFooter)
