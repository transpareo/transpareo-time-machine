/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-properties>, the flat property list driven by
 * the snapshot's top-level `properties` collection plus
 * the per-user private rows the auth-gated endpoint
 * returns. Layout is two stacked sections:
 *
 *   1. Public list - category-1 (always-visible) and
 *      category-2 (on-demand) rows from snapshot
 *      .properties. On-demand rows only render when
 *      their namespace is unlocked by the URL's `?show=`
 *      token list.
 *   2. "Additional product data" - category-3 rows that
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
import { activeSnapshot, activeVersionNumber } from '@/state'
import { i18n, formatNumber } from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'
import {
  tx, propertyIsKind, type PropertyValue, type PropertyValueOf,
} from '@/types'
import { showTokens, isUnlocked } from '@/show-filter'
import {
  fetchStateByVersion,
  requestPrivateRowsFetch,
  type PrivateFetchState,
} from '@/private-properties'
import { authModalOpen } from '@/components/dpp-auth-modal'

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
      const aff = affordance(state)

      const children: HTMLElement[] = publicRows.map(buildRow)
      if (privateRows.length > 0) {
        children.push(buildHeading(tr('properties.additionalHeading')))
        for (const r of privateRows) children.push(buildRow(r))
      }
      if (aff) children.push(aff)

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
  return detailRows(activeSnapshot().properties)
}

function visiblePrivateRows(
  state: PrivateFetchState | undefined,
): ReadonlyArray<ScalarRow> {
  return state?.status === 'ok' ? detailRows(state.rows) : []
}

function affordance(
  state: PrivateFetchState | undefined,
): HTMLElement | null {
  if (!state) return null
  if (state.status === 'unauth') return buildSignInButton()
  if (state.status === 'error') return buildRetryAffordance()
  return null
}

function buildRow(row: ScalarRow): HTMLElement {
  const wrap = el('div', 'dpp-property-row')
  const v = row.value
  const resolved = v.numeric != null
    ? formatNumber(v.numeric) : tx(v.value, i18n.locale)
  const value = v.unit ? `${resolved} ${v.unit}` : resolved
  wrap.append(
    el('div', 'dpp-property-label', tx(row.name, i18n.locale)),
    el('div', 'dpp-property-value', value),
  )
  return wrap
}

function buildHeading(text: string): HTMLElement {
  return el('h3', 'dpp-properties-heading', text)
}

function buildSignInButton(): HTMLElement {
  const btn = el(
    'button', 'dpp-properties-affordance', tr('properties.signInForData'),
  ) as HTMLButtonElement
  btn.type = 'button'
  btn.addEventListener('click', () => {
    authModalOpen.set(true)
    void requestPrivateRowsFetch()
  })
  return btn
}

function buildRetryAffordance(): HTMLElement {
  const wrap = el('div', 'dpp-properties-error')
  wrap.append(
    el('span', 'dpp-properties-error-text', tr('properties.loadError')),
  )
  const btn = el(
    'button', 'dpp-properties-retry', tr('properties.retry'),
  ) as HTMLButtonElement
  btn.type = 'button'
  btn.addEventListener('click', () => {
    void requestPrivateRowsFetch()
  })
  wrap.appendChild(btn)
  return wrap
}

customElements.define('dpp-properties', DppProperties)
