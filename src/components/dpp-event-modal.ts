/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-event-modal>, drawer surfacing the full record
 * for the currently-focused DppEvent: the renderer's own
 * fields (type, status transition, actor, description,
 * version) plus, when this event was projected to the
 * public EPCIS file
 *   {publisher_slug}/dpp/{code}/events.jsonld.gz
 * the matching ObjectEvent and its raw JSON-LD payload.
 *
 * Opened by the "Details" link in the timeline's event-
 * details card. Closed via Escape, X, or overlay-click.
 */

import { LightElement } from '@/reactive/element'
import { signal } from '@/reactive/signals'
import { el } from '@/reactive/dom'
import { bindModalChrome, buildModal } from '@/reactive/modal'
import { sortedEvents, epcisByEventId, snapshotForVersion } from '@/state'
import { manifest as manifestSignal } from '@/host'
import { i18n, formatShortDate } from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'
import { colorForEventType } from '@/event-colors'
import { icon } from '@/icons'
import { tx, type DppEvent, type PropertyValue } from '@/types'
import {
  cbvLabel, glnFromUri, epcShortLabel,
  type EpcisObjectEvent,
} from '@/epcis'
import { downloadJson, slugForFilename } from '@/download'

// id of the DppEvent whose modal is open. Null = closed.
export const eventModalEventId = signal<string | null>(null)

class DppEventModal extends LightElement {
  protected setup(): void {
    this.setAttribute('aria-labelledby', 'event-modal-title')

    bindModalChrome(this, this.effect.bind(this), {
      isOpen: () => eventModalEventId() != null,
      onClose: close,
    })

    this.effect(() => this.render())
  }

  private render(): void {
    const id = eventModalEventId()
    const evt = id ? sortedEvents().find((e) => e.id === id) : null
    if (!evt) {
      this.classList.remove('open')
      this.replaceChildren()
      return
    }

    const epcis = epcisByEventId()[evt.id]
    const body = document.createDocumentFragment()
    body.append(buildEventSection(evt))
    const changeSet = buildChangeSetSection(evt)
    if (changeSet) body.appendChild(changeSet)
    if (evt.description) body.appendChild(buildDescriptionSection(evt))
    if (epcis) body.appendChild(buildEpcisSection(epcis))

    const dialog = buildModal({
      title: tr('event.title'),
      titleId: 'event-modal-title',
      accent: colorForEventType(evt.eventType),
      body,
      onClose: close,
    })
    this.replaceChildren(dialog)
    this.classList.add('open')
  }
}

function close(): void {
  eventModalEventId.set(null)
}

function tr(key: LabelKey, vars?: Record<string, string | number>): string {
  return t(i18n.labels, key, vars)
}

function buildEventSection(evt: DppEvent): HTMLElement {
  const section = el('section', 'event-modal-section')
  section.append(buildEventGrid(evt))
  return section
}

function buildEventGrid(evt: DppEvent): HTMLElement {
  const dl = el('dl', 'event-modal-grid')
  dl.style.setProperty('--event-color', colorForEventType(evt.eventType))

  const add = (label: LabelKey, value: Node | string): void => {
    const dt = el('dt', undefined, tr(label))
    const dd = el('dd')
    if (typeof value === 'string') dd.textContent = value
    else dd.appendChild(value)
    dl.append(dt, dd)
  }

  const tagKey = `eventType.${evt.eventType}` as LabelKey
  add('event.type', el('span', 'event-tag', tr(tagKey)))
  add('event.date', formatShortDate(evt.occurredAt, i18n.locale))

  if (evt.statusFrom && evt.statusTo) {
    add('event.statusChange', buildStatusTransition(evt))
  } else if (evt.statusTo) {
    add('event.status', tr(`status.${evt.statusTo}` as LabelKey))
  }
  if (evt.actorLabel) add('event.actor', evt.actorLabel)
  if (evt.versionNumber != null) {
    add('event.version', `v${evt.versionNumber}`)
  }

  return dl
}

function buildStatusTransition(evt: DppEvent): HTMLElement {
  const wrap = el('span', 'event-modal-status')
  const arrowWrap = el('span', 'event-modal-status-arrow')
  arrowWrap.appendChild(icon('arrow'))
  wrap.append(
    el('span', 'event-modal-status-from',
      tr(`status.${evt.statusFrom}` as LabelKey)),
    arrowWrap,
    el('span', 'event-modal-status-to',
      tr(`status.${evt.statusTo}` as LabelKey)),
  )
  return wrap
}

// "Changed since v{prior}" delta for the version this event
// published: added / modified labels resolve off this
// version's rows, removed off the prior version's (a removed
// property is, by definition, gone from the current rows).
// Falls back to the raw propertyID when the resolving
// snapshot is not loaded. Absent when the version carries no
// ChangeSet (v1 or no property-level change).
function buildChangeSetSection(evt: DppEvent): HTMLElement | null {
  const v = evt.versionNumber
  if (v == null) return null
  const snap = snapshotForVersion(v)
  const cs = snap?.changedProperties
  if (!snap || !cs) return null

  const prior = snap.priorVersion ?? v - 1
  const priorRows = snapshotForVersion(prior)?.properties
  const names = (
    ids: ReadonlyArray<string>,
    rows: ReadonlyArray<PropertyValue> | undefined,
  ): string => ids.map((id) => {
    const row = rows?.find((r) => r.key === id)
    return row ? tx(row.name, i18n.locale) : id
  }).join(', ')

  const section = el('section', 'event-modal-section')
  section.appendChild(el(
    'h3', 'event-modal-subtitle', tr('changeSet.title', { version: prior }),
  ))

  const dl = el('dl', 'change-set-grid')
  const addRow = (
    cls: string, label: LabelKey,
    ids: ReadonlyArray<string>,
    rows: ReadonlyArray<PropertyValue> | undefined,
  ): void => {
    if (!ids.length) return
    dl.append(
      el('dt', `change-set-kind ${cls}`, tr(label)),
      el('dd', 'change-set-names', names(ids, rows)),
    )
  }
  addRow('is-added', 'changeSet.added', cs.added, snap.properties)
  addRow('is-modified', 'changeSet.modified', cs.modified, snap.properties)
  addRow('is-removed', 'changeSet.removed', cs.removed, priorRows)
  section.appendChild(dl)
  return section
}

function buildDescriptionSection(evt: DppEvent): HTMLElement {
  const section = el('section', 'event-modal-section')
  section.append(
    el('h3', 'event-modal-subtitle', tr('event.description')),
    el('p', 'event-modal-description', tx(evt.description!, i18n.locale)),
  )
  return section
}

function buildEpcisSection(ev: EpcisObjectEvent): HTMLElement {
  // EPCIS is consumer-noise (URIs, CBV CURIEs, GLNs, ISO
  // timestamps). Wrap it in a closed-by-default <details>
  // labelled "Technical details" so the main modal stays
  // simple and only readers who want the machine-readable
  // record have to look at it.
  const section = el('section', 'event-modal-section')
  const details = el('details', 'event-modal-disclosure')
  const summary = el('summary', 'event-modal-disclosure-summary')
  summary.append(
    el('span', 'event-modal-disclosure-label', tr('epcis.title')),
    el('span', 'chevron'),
  )
  details.append(summary, buildEpcisCard(ev))
  section.appendChild(details)
  return section
}

function buildEpcisCard(ev: EpcisObjectEvent): HTMLElement {
  const card = el('div', 'epcis-card')
  card.append(buildEpcisGrid(ev), buildRawJson(ev))
  return card
}

function buildEpcisGrid(ev: EpcisObjectEvent): HTMLElement {
  const dl = el('dl', 'epcis-grid')
  const add = (label: LabelKey, value: Node | string): void => {
    const dt = el('dt', undefined, tr(label))
    const dd = el('dd')
    if (typeof value === 'string') dd.textContent = value
    else dd.appendChild(value)
    dl.append(dt, dd)
  }

  add('epcis.eventID', el('code', undefined, ev.eventID))
  add('epcis.eventTime', `${ev.eventTime} (UTC${ev.eventTimeZoneOffset})`)
  if (ev.recordTime) add('epcis.recordTime', ev.recordTime)
  add('epcis.action', ev.action)
  if (ev.bizStep) add('epcis.bizStep', buildCbvCell(ev.bizStep))
  if (ev.disposition) add('epcis.disposition', buildCbvCell(ev.disposition))
  add('epcis.epcList', buildEpcList(ev.epcList))
  if (ev.readPoint?.id) {
    add('epcis.readPoint', buildLocationCell(ev.readPoint.id))
  }
  if (ev.bizLocation?.id) {
    add('epcis.bizLocation', buildLocationCell(ev.bizLocation.id))
  }
  const scope = ev['transpareo:scope']
  if (typeof scope === 'string') add('epcis.scope', scope)
  return dl
}

function buildCbvCell(curie: string): HTMLElement {
  const wrap = el('span', 'epcis-cbv')
  wrap.append(
    el('span', 'epcis-cbv-label', cbvLabel(curie)),
    el('code', 'epcis-cbv-curie', curie),
  )
  return wrap
}

function buildLocationCell(uri: string): HTMLElement {
  const wrap = el('span', 'epcis-location')
  const gln = glnFromUri(uri)
  if (gln !== uri) {
    wrap.append(
      el('span', 'epcis-gln', `${tr('epcis.glnPrefix')} ${gln}`),
      el('code', undefined, uri),
    )
  } else {
    wrap.appendChild(el('code', undefined, uri))
  }
  return wrap
}

function buildEpcList(list: ReadonlyArray<string>): HTMLElement {
  const ul = el('ul', 'epcis-epc-list')
  for (const uri of list) {
    const li = el('li')
    li.append(
      el('span', 'epcis-epc-short', epcShortLabel(uri)),
      el('code', undefined, uri),
    )
    ul.appendChild(li)
  }
  return ul
}

function buildRawJson(ev: EpcisObjectEvent): HTMLElement {
  const wrap = el('div', 'epcis-raw')
  const head = el('div', 'epcis-raw-head')
  const actions = el('div', 'epcis-raw-actions')
  actions.append(buildCopyButton(ev), buildDownloadButton(ev))
  head.append(
    el('h4', 'epcis-raw-title', tr('epcis.rawJson')),
    actions,
  )
  wrap.append(head, buildJsonBlock(ev))
  return wrap
}

// Download the EPCIS payload as a standalone .json file
// so an auditor can drop it into a CBV-aware viewer or
// keep it alongside the snapshot bytes pulled from the
// verification modal. Filename derives from the active
// manifest's code + the EPCIS eventID so multi-event
// downloads stay distinguishable on disk.
function buildDownloadButton(ev: EpcisObjectEvent): HTMLButtonElement {
  const btn = el('button', 'epcis-download')
  btn.type = 'button'
  btn.append(icon('download'), document.createTextNode(' '))
  btn.appendChild(document.createTextNode(tr('epcis.download')))
  btn.addEventListener('click', () => {
    const code = manifestSignal()?.code ?? 'event'
    const slug = slugForFilename(`${code}-${ev.eventID}`)
    downloadJson(ev, slug)
  })
  return btn
}

function buildCopyButton(ev: EpcisObjectEvent): HTMLButtonElement {
  const btn = el('button', 'epcis-copy')
  btn.type = 'button'
  btn.textContent = tr('epcis.copy')
  btn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(JSON.stringify(ev, null, 2))
    const original = btn.textContent
    btn.textContent = tr('epcis.copied')
    btn.classList.add('copied')
    window.setTimeout(() => {
      btn.textContent = original
      btn.classList.remove('copied')
    }, 1400)
  })
  return btn
}

function buildJsonBlock(ev: EpcisObjectEvent): HTMLElement {
  const pre = el('pre', 'epcis-json')
  pre.textContent = JSON.stringify(ev, null, 2)
  return pre
}

customElements.define('dpp-event-modal', DppEventModal)
