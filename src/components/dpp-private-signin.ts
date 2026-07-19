/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * End-of-passport prompt for authenticated (category-3) data.
 * When the active version's privateProperties endpoint answers
 * 401, this shows a "Sign in for additional product data"
 * button that hands the whole page off to the authorising
 * system's login (see private-properties.ts); an errored fetch
 * shows a retry instead. The authorised rows themselves merge
 * into the property table once they arrive; this element only
 * carries the prompt, placed after the last content section so
 * it reads as "there is more beyond the passport" rather than
 * interrupting the spec list.
 */
import { LightElement } from '@/reactive/element'
import { el } from '@/reactive/dom'
import { activeVersionNumber } from '@/state'
import { i18n } from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'
import {
  fetchStateByVersion,
  requestPrivateRowsFetch,
  type PrivateFetchState,
} from '@/private-properties'

const tr = (key: LabelKey): string => t(i18n.labels, key)

class DppPrivateSignin extends LightElement {
  protected setup(): void {
    const wrap = el('div', 'dpp-private-signin')
    this.appendChild(wrap)

    this.effect(() => {
      const state = fetchStateByVersion()[activeVersionNumber()]
      const aff = affordance(state)
      wrap.style.display = aff ? '' : 'none'
      wrap.replaceChildren(...(aff ? [aff] : []))
    })
  }
}

function affordance(
  state: PrivateFetchState | undefined,
): HTMLElement | null {
  if (!state) return null
  if (state.status === 'unauth' && state.loginUrl) {
    return buildSignInButton(state.loginUrl)
  }
  if (state.status === 'error') return buildRetryAffordance()
  return null
}

function buildSignInButton(loginUrl: string): HTMLElement {
  const btn = el(
    'button', 'dpp-properties-affordance', tr('properties.signInForData'),
  ) as HTMLButtonElement
  btn.type = 'button'

  // Full-page hand-off: send the whole page to the authorising
  // system's login, carrying a return target so it can bring
  // the user back. The URL is already held to the page's
  // registrable site (parseLoginUrl), so this can't be an open
  // redirect. On return the passport reloads and the fetch
  // re-runs against the new session.
  btn.addEventListener('click', () => {
    const back = encodeURIComponent(window.location.href)
    const sep = loginUrl.includes('?') ? '&' : '?'
    window.location.assign(`${loginUrl}${sep}return=${back}`)
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

customElements.define('dpp-private-signin', DppPrivateSignin)
