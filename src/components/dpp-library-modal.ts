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
 * name) comes straight from the snapshot, so it renders
 * synchronously when the modal opens. A substance's
 * `countryCode` is deliberately not part of it: origin was
 * dropped from the composition surface as a whole. Live
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
  REGION_DATATYPE,
} from '@/types'
import { i18n, formatNumber } from '@/i18n'
import { regionName } from '@/i18n/display-names'
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
      return enumLabel(value)
  }
}

// A library artefact bakes an enum's label per locale at
// publish time, so a locale the publisher's map missed
// falls back to English, or to nothing when the map is
// empty. For a country the renderer can do better than the
// map: an ISO 3166-1 code names itself in the viewer's
// language through Intl, which also covers artefacts
// published before a gap in the map was noticed.
//
// The baked label wins wherever it carries the active
// locale, since a publisher may have worded it deliberately.
export function enumLabel(
  value: Extract<ComponentPropertyValue, { type: 'enum' }>,
): string {
  // A declared country resolves before the baked label is
  // consulted, because the datatype's own definition puts
  // the naming on the reader, in the reader's language, and
  // because a name frozen at publish time goes stale in a
  // way a code does not: Türkiye, Czechia and Eswatini all
  // changed inside one decade and their codes did not. A
  // publisher that wants particular wording wants a text
  // row, not a code-list value.
  if (value.dataType === REGION_DATATYPE) {
    const declared = regionName(value.value, i18n.locale)
    if (declared) return declared
  }

  const label = value.label
  const exact = typeof label === 'string' ? label : label?.[i18n.locale]
  if (exact) return exact

  const named = countryNameFromLabel(value)
  if (named) return named

  // tx() answers '' for a map with nothing in it, so the
  // code itself is the last resort rather than a blank cell.
  return tx(label, i18n.locale) || value.value
}

// The viewer's name for an undeclared enum that is a
// country anyway, or null for one that merely looks like a
// country code.
//
// A row carrying the datatype never reaches this: it is
// resolved above, on the artefact's own word. This is the
// path for rows that predate the field, and library entries
// republish lazily, so those keep arriving for as long as a
// component goes untouched. Here the code alone has to
// carry it, and the code alone is not enough: plenty of
// two-letter values a publisher might enumerate are also
// assigned regions, and "NO" for a boolean, "ID" for an
// identifier kind or "IS" for a class would render as
// Norway, Indonesia and Iceland. Confidently wrong in the
// reader's own language is worse than untranslated English.
// So the publisher's own English label has to agree that the
// code means that country; deliberate wording ("Portugal
// (EU)") and a map with no English entry both fail that and
// keep the existing fallback, which is the safe direction.
function countryNameFromLabel(
  value: Extract<ComponentPropertyValue, { type: 'enum' }>,
): string | null {
  const label = value.label
  const english = typeof label === 'string' ? label : label?.en
  if (!english || english !== regionName(value.value, 'en')) return null
  return regionName(value.value, i18n.locale)
}

customElements.define('dpp-library-modal', DppLibraryModal)
