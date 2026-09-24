/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-properties>, the flat property list driven by
 * the snapshot's top-level `properties` collection plus
 * the per-user private rows the auth-gated endpoint
 * returns, plus the passport's live values. Layout is
 * three stacked sections:
 *
 *   1. Public list - category-1 (always-visible) and
 *      category-2 (on-demand) rows from snapshot
 *      .properties. On-demand rows only render when
 *      their namespace is unlocked by the URL's `?show=`
 *      token list.
 *   2. "Current state" - the rows the snapshot marks
 *      dynamic, each with its reading from the dynamic-data
 *      document and the time that was written. They belong
 *      to today, so they show on the current version only.
 *      A reading shows once its document's signature has
 *      cleared (see actions.liveDataIsShowable); until
 *      then, or without one, the property shows the
 *      reading its snapshot sealed at publish.
 *   3. "Additional product data" - category-3 rows that
 *      arrived as `{ status: 'ok', rows }` from the
 *      manifest's `privateProperties.url` endpoint. The
 *      same `?show=` filter applies to private rows that
 *      carry `onDemand: true`, so server-side privacy
 *      and client-side presentation gates compose.
 *
 * The component also surfaces an affordance based on
 * the per-version fetch state:
 *
 *   - unauth   -> "Sign in for additional product data"
 *                  button that opens the auth modal.
 *   - error    -> "Additional product data temporarily
 *                  unavailable" + retry button.
 *   - ok/empty -> nothing extra.
 *
 * The element is hidden entirely when no row, no
 * private affordance, and no error affordance applies,
 * so demos that haven't adopted the new schema get no
 * empty section.
 */

import { LightElement } from '@/reactive/element'
import { el } from '@/reactive/dom'
import {
  activeSnapshot, activeVersionNumber, isOnCurrent, dynamicDataProofState,
  renderedPresentation,
} from '@/state'
import { dynamicData, dynamicDataPending, composeLiveRows } from '@/host'
import { liveDataIsShowable } from '@/actions'
import { i18n, formatNumber, formatDateTime } from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'
import {
  tx, propertyIsKind, type LiveRow, type PropertyValue, type PropertyValueOf,
} from '@/types'
import { showTokens, isUnlocked } from '@/show-filter'
import {
  fetchStateByVersion,
  type PrivateFetchState,
} from '@/private-properties'

// Short alias for the active-locale label lookup, used by
// the private-tier rows below.
const tr = (key: LabelKey): string => t(i18n.labels, key)

class DppProperties extends LightElement {
  protected setup(): void {
    const wrap = el('div', 'dpp-properties')
    this.appendChild(wrap)

    this.effect(() => {
      const publicRows = visiblePublicRows()
      const ver = activeVersionNumber()
      const state = fetchStateByVersion()[ver]
      const privateRows = visiblePrivateRows(state)

      const children: HTMLElement[] = publicRows.map(buildRow)
      children.push(...buildLiveSection())
      if (privateRows.length > 0) {
        children.push(buildHeading(tr('properties.additionalHeading')))
        for (const r of privateRows) children.push(buildRow(r))
      }

      const hasContent = children.length > 0
      wrap.style.display = hasContent ? '' : 'none'
      wrap.replaceChildren(...children)
    })
  }
}

type ScalarRow = PropertyValueOf<'scalar'>

// The detail table shows namespaced scalar rows.
// Tiles, badges, accordions, and donuts have their own
// renderers and pull the rest of the flat list. Public rows come
// from snapshot.properties; private rows arrive
// post-auth via the privateProperties endpoint and use
// the same filter so the two sides compose.
function detailRows(
  rows: ReadonlyArray<PropertyValue>,
): ReadonlyArray<ScalarRow> {
  const tokens = showTokens()
  return rows
    .filter(propertyIsKind('scalar'))
    .filter((r) => r.namespace != null)
    .filter((r) => !r.onDemand || isUnlocked(r.namespace, tokens))
}

function visiblePublicRows(): ReadonlyArray<ScalarRow> {
  return detailRows(renderedPresentation())
}

function visiblePrivateRows(
  state: PrivateFetchState | undefined,
): ReadonlyArray<ScalarRow> {
  return state?.status === 'ok' ? detailRows(state.rows) : []
}

// The live section: heading, when the readings were
// written, then one row per live property. Held while the
// document is in flight or being checked. A property with
// no verified reading shows the one sealed at publish.
function buildLiveSection(): HTMLElement[] {
  if (!isOnCurrent()) return []
  const doc = dynamicData()
  const state = dynamicDataProofState()
  if (dynamicDataPending() || (doc && state === 'pending')) return []

  // The document is the publisher's to write, and a
  // malformed one must cost the live section only.
  const verified = doc && liveDataIsShowable(state) ? doc : null
  const values = Array.isArray(verified?.values) ? verified.values : null
  const rows = composeLiveRows(activeSnapshot().properties, values)
  if (rows.length === 0) return []

  const out = [buildHeading(tr('properties.liveHeading'))]
  const time = verified && formatDateTime(verified.updatedAt, i18n.locale)
  if (time) {
    const text = t(i18n.labels, 'properties.liveUpdated', { time })
    out.push(el('p', 'dpp-properties-updated', text))
  }
  return [...out, ...rows.map(buildLiveRow)]
}

function buildLiveRow(row: LiveRow): HTMLElement {
  const label = tx(row.name, i18n.locale)
  return buildPair(label, formatValue(row.value), !row.live)
}

// A row marked dynamic outside the live block is a past
// version's: its value is the reading sealed at publish.
function buildRow(row: ScalarRow): HTMLElement {
  const label = tx(row.name, i18n.locale)
  return buildPair(label, formatValue(row.value), row.dynamic === true)
}

function formatValue(v: ScalarRow['value']): string {
  const resolved = v.numeric != null
    ? formatNumber(v.numeric) : tx(v.value, i18n.locale)
  return v.unit ? `${resolved} ${v.unit}` : resolved
}

// A label and its value; a reading sealed at publish says
// so beneath the value.
function buildPair(
  label: string, value: string, atPublish: boolean,
): HTMLElement {
  const wrap = el('div', 'dpp-property-row')
  const cell = el('div', 'dpp-property-value', value)
  if (atPublish) {
    cell.append(el('span', 'dpp-property-note', tr('properties.atPublish')))
  }
  wrap.append(el('div', 'dpp-property-label', label), cell)
  return wrap
}

function buildHeading(text: string): HTMLElement {
  return el('h3', 'dpp-properties-heading', text)
}

customElements.define('dpp-properties', DppProperties)
