// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The renderer carries the verifier widget only into verifier
 * mode. A passport page never mounts it, so its code stays out
 * of what every passport visitor downloads, and the element
 * fetches it the moment verifier mode asks for it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import '@/components/transpareo-time-machine'
import { config } from '@/config'

vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}')))

afterEach(() => {
  document.body.replaceChildren()
  delete (config as { verifier?: boolean }).verifier
})

describe('the verifier widget', () => {
  it('stays undefined until something mounts it', () => {
    expect(customElements.get('dpp-verifier')).toBeUndefined()
  })

  it('arrives once verifier mode mounts it', async () => {
    const tm = document.createElement('transpareo-time-machine')
    tm.setAttribute('verifier', '')
    document.body.appendChild(tm)

    await vi.waitFor(() => {
      const widget = tm.shadowRoot?.querySelector('dpp-verifier')
      expect(widget?.shadowRoot?.querySelector('.verifier-submit')).
        not.toBeNull()
    })
  })
})
