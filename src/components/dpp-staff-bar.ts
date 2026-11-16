/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-staff-bar>, a band under the brandbar for the
 * publisher's own staff: a link that opens this passport in
 * their back office. While one of them is signed in, the back
 * office on the passport's own origin keeps the address of its
 * lookup by code and the wording of the link in localStorage
 * (session-hints.ts); the band shows only while both are
 * there, so every other reader sees the page unchanged. No
 * server is asked, and the back office still decides who opens
 * what.
 */

import { LightElement } from '@/reactive/element'
import { el } from '@/reactive/dom'
import * as host from '@/host'
import { icon } from '@/icons'
import { storedStaffLink } from '@/session-hints'

class DppStaffBar extends LightElement {
  protected setup(): void {
    const stored = storedStaffLink()

    // A framed passport sits inside another page, a preview or
    // an embed, and draws no band there.
    if (!stored || window.self !== window.top) return

    this.effect(() => {
      const code = host.manifest()?.code ?? ''
      const href = staffBarHref(stored.url, code, window.location.href)
      if (!href) {
        this.replaceChildren()
        return
      }
      const link = el('a', 'staff-bar', stored.label)
      link.prepend(icon('key'), ' ')
      link.href = href
      this.replaceChildren(link)
    })
  }
}

// The stored address with the passport's code in place of its
// `{code}`, or null. Any script on the origin can write the
// store, so the link is held to the page's own origin and
// never leads away from it.
export function staffBarHref(
  stored: string, code: string, page: string
): string | null {
  if (!code) return null
  let url: URL
  try {
    url = new URL(stored.replaceAll('{code}', encodeURIComponent(code)), page)
  } catch {
    return null
  }
  if (url.origin !== new URL(page).origin) return null
  return url.href
}

customElements.define('dpp-staff-bar', DppStaffBar)
