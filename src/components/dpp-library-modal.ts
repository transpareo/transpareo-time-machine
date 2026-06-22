/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-library-modal>, detail drawer for a single
 * composition entry whose snapshot row carries a
 * `libraryRef`. The host element is its own overlay;
 * chrome (header, close, escape, click-outside, scroll-
 * lock) is wired by `bindModalChrome` + `buildModal`.
 *
 * The frozen lead (percent + rating + locale-resolved
 * name + flag) comes straight from the snapshot, so it
 * renders synchronously when the modal opens. Live
 * library data (properties, references, free-text name
 * overrides) is fetched lazily from the public bucket
 * and slots in below, with a loading state while it
 * arrives. If the object is missing or the fetch fails,
 * the modal simply shows the frozen lead with nothing
 * below, no "unavailable" notice.
 */

import { LightElement } from '@/reactive/element'
import { signal } from '@/reactive/signals'
import { el } from '@/reactive/dom'
import { safeLinkHref } from '@/safe-url'
import { bindModalChrome, buildModal } from '@/reactive/modal'
import {
  type ComponentLookup,
  type ComponentProperty,
  type ComponentPropertyValue,
  type ComponentPropertyListItem,
  type CompositionEntry,
  tx,
} from '@/types'
import { i18n, formatNumber } from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'
import { lookupLibrary } from '@/library-lookup'
import { buildRatingRow, buildKvRow, ratingIcon } from '@/rating'

type LookupState =
  | { status: 'loading' }
  | { status: 'ready'; data: ComponentLookup }
  | { status: 'unavailable' }

// Module-level signal: any host can open the modal by
// setting an entry, and close by resetting to null.
export const selectedLibraryEntry =
  signal<CompositionEntry | null>(null)

const lookupState = signal<LookupState>({ status: 'loading' })

function tr(key: LabelKey): string {
  return t(i18n.labels, key)
}

class DppLibraryModal extends LightElement {
  protected setup(): void {
    bindModalChrome(this, this.effect.bind(this), {
      isOpen: () => selectedLibraryEntry() != null,
      onClose: close,
    })

    // Fire the lookup whenever a new entry opens. Reset
    // to loading first so a stale payload can't flash
    // into the next entry's modal.
    this.effect(() => {
      const entry = selectedLibraryEntry()
      if (!entry?.libraryRef) {
        lookupState.set({ status: 'unavailable' })
        return
      }
      const ref = entry.libraryRef
      lookupState.set({ status: 'loading' })
      void lookupLibrary(ref).then((data) => {
        // Guard against a race: the user may have closed
        // or switched the modal during the fetch.
        if (selectedLibraryEntry()?.libraryRef !== ref) return
        lookupState.set(
          data ? { status: 'ready', data } : { status: 'unavailable' },
        )
      }).catch(() => {
        // A rejected lookupLibrary (transient network,
        // CORS, etc.) without this branch would leave the
        // modal pinned on 'loading' forever. lookupLibrary
        // already maps non-2xx + thrown errors to a
        // resolved null, so reaching this branch is rare;
        // we collapse to 'unavailable' (same UX as a
        // missing library object) to stay self-healing.
        if (selectedLibraryEntry()?.libraryRef !== ref) return
        lookupState.set({ status: 'unavailable' })
      })
    })

    this.effect(() => this.render())
  }

  private render(): void {
    const entry = selectedLibraryEntry()
    if (!entry) {
      this.classList.remove('open')
      this.replaceChildren()
      return
    }

    const name = tx(entry.name, i18n.locale)
    this.setAttribute(
      'aria-label', `${name} ${tr('component.details.aria')}`,
    )

    const dialog = buildModal({
      title: name,
      body: buildBody(entry, lookupState()),
      onClose: close,
    })
    this.replaceChildren(dialog)
    this.classList.add('open')
  }
}

function close(): void {
  selectedLibraryEntry.set(null)
}

function buildBody(
  entry: CompositionEntry,
  state: LookupState,
): DocumentFragment {
  const frag = document.createDocumentFragment()
  const lead = el('div', 'dpp-library-lead')
  if (entry.rating) lead.append(buildRatingRow(entry.rating))
  if (entry.percent != null) {
    lead.append(
      buildKvRow(tr('component.share'), `${formatNumber(entry.percent)}%`),
    )
  }
  frag.appendChild(lead)

  // 'unavailable' adds nothing below the lead: a component
  // whose library object is missing or failed to load just
  // shows its frozen snapshot data, with no "missing"
  // notice.
  if (state.status === 'ready') {
    frag.appendChild(buildLibrary(state.data))
  } else if (state.status === 'loading') {
    frag.appendChild(buildLibraryLoading())
  }

  return frag
}

function buildLibrary(data: ComponentLookup): HTMLElement {
  const wrap = el('div', 'dpp-library-panel')
  for (const prop of data.properties) {
    wrap.appendChild(buildPropertyRow(prop))
  }
  if (data.references?.length) {
    wrap.appendChild(buildReferences(data.references))
  }
  return wrap
}

function buildLibraryLoading(): HTMLElement {
  const wrap = el('div', 'dpp-library-panel loading')
  wrap.appendChild(
    el('div', 'dpp-library-loading', tr('component.libraryLoading')),
  )
  return wrap
}

function buildPropertyRow(prop: ComponentProperty): HTMLElement {
  const row = el('div', 'dpp-library-row')
  row.append(
    el('div', 'dpp-library-row-label', tx(prop.label, i18n.locale)),
    buildPropertyValue(prop.value),
  )
  return row
}

function buildPropertyValue(
  value: ComponentPropertyValue,
): HTMLElement {
  if (value.type === 'list') return buildListValue(value.items)
  return el('div', 'dpp-library-row-value', formatScalarValue(value))
}

function buildListValue(
  items: ReadonlyArray<ComponentPropertyListItem>,
): HTMLElement {
  // Any item with a rating flips the whole list into a
  // bulleted layout, one smiley + text per row. Otherwise
  // the list reads as an inline, comma-separated phrase
  // so unrated multi-value fields (alternative names,
  // tags, etc.) stay compact.
  const rated = items.some((it) => it.rating)
  if (rated) return buildRatedList(items)
  return buildInlineList(items)
}

function buildRatedList(
  items: ReadonlyArray<ComponentPropertyListItem>,
): HTMLElement {
  const ul = el('ul', 'dpp-library-row-value dpp-library-rated-list')
  for (const item of items) {
    const li = el('li', 'dpp-library-rated-item')
    if (item.rating) li.appendChild(ratingIcon(item.rating))
    li.appendChild(document.createTextNode(tx(item.text, i18n.locale)))
    ul.appendChild(li)
  }
  return ul
}

function buildInlineList(
  items: ReadonlyArray<ComponentPropertyListItem>,
): HTMLElement {
  const text = items
    .map((it) => tx(it.text, i18n.locale))
    .join(', ')
  return el('div', 'dpp-library-row-value', text)
}

function buildReferences(
  refs: ReadonlyArray<{ readonly label: import('@/types').LocalizedText
    readonly href: string }>,
): HTMLElement {
  const wrap = el('div', 'dpp-library-references')
  wrap.append(el('div', 'dpp-library-row-label', tr('component.references')))
  const list = el('ul', 'dpp-library-reference-list')
  for (const r of refs) {
    const li = el('li')
    const a = el('a', 'dpp-library-reference', tx(r.label, i18n.locale))
    const safe = safeLinkHref(r.href)
    if (safe) {
      a.href = safe
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
    }
    li.appendChild(a)
    list.appendChild(li)
  }
  wrap.appendChild(list)
  return wrap
}

function formatScalarValue(
  value: Exclude<ComponentPropertyValue, { type: 'list' }>,
): string {
  switch (value.type) {
    case 'text':
      return tx(value.value, i18n.locale)
    case 'percent':
      return `${formatNumber(value.value)}%`
    case 'decimal':
      return value.unit
        ? `${formatNumber(value.value)} ${value.unit}`
        : formatNumber(value.value)
    case 'enum':
      return tx(value.label, i18n.locale)
  }
}

customElements.define('dpp-library-modal', DppLibraryModal)
