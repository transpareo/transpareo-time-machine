// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Brandbar visibility policy. The chip follows
 * verificationMarkVisible (explicit attribute wins; a
 * lone unsigned snapshot hides it by default), and when
 * neither a themed logo nor the chip renders, the bar
 * itself renders nothing: an empty sticky header would be
 * nothing but whitespace above the hero.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { config } from '@/config'
import * as host from '@/host'
import type { DppSnapshot } from '@/types'
import type { DppManifest } from '@/archive'
import '@/components/dpp-brandbar'

type MutableConfig = { showVerificationMark?: boolean }

function seedSnapshot(signed: boolean): void {
  const proof = signed ? [{ proofValue: 'z1' }] : []
  host.currentVersion.set(1)
  host.snapshots.set({
    1: { version: 1, status: 'in_use', proof } as unknown as DppSnapshot
  })
}

function mount(logoUrl?: string): HTMLElement {
  const el = document.createElement('dpp-brandbar')
  if (logoUrl) el.style.setProperty('--logo-url', logoUrl)
  document.body.appendChild(el)
  return el
}

afterEach(() => {
  delete (config as MutableConfig).showVerificationMark
  host.manifest.set(null)
  document.body.replaceChildren()
})

describe('dpp-brandbar', () => {
  it('renders no bar with the chip off and no themed logo', () => {
    ;(config as MutableConfig).showVerificationMark = false
    seedSnapshot(true)
    const el = mount()
    expect(el.querySelector('.brandbar')).toBeNull()
    expect(el.querySelector('.brandbar-sentinel')).toBeNull()
  })

  it('keeps the bar for the chip alone', () => {
    seedSnapshot(true)
    const el = mount()
    expect(el.querySelector('.brandbar')).not.toBeNull()
    expect(el.querySelector('dpp-verification-chip')).not.toBeNull()
  })

  it('keeps the bar for a themed logo alone', () => {
    ;(config as MutableConfig).showVerificationMark = false
    seedSnapshot(true)
    const el = mount('url(/logo.svg)')
    expect(el.querySelector('.brandbar')).not.toBeNull()
    expect(el.querySelector('dpp-verification-chip')).toBeNull()
  })

  it('hides the chip for a lone unsigned snapshot by default', () => {
    // No manifest, no proof: the DPP never claimed
    // verifiability, so no verification chrome (and here,
    // with no logo either, no bar at all).
    seedSnapshot(false)
    const el = mount()
    expect(el.querySelector('.brandbar')).toBeNull()
  })

  it('shows the question-mark chip when explicitly forced', () => {
    ;(config as MutableConfig).showVerificationMark = true
    seedSnapshot(false)
    const el = mount()
    expect(el.querySelector('dpp-verification-chip')).not.toBeNull()
  })

  it('keeps the chip for an unsigned snapshot under a manifest', () => {
    // A manifest DPP claims verifiability; a missing
    // snapshot proof must surface, not vanish.
    seedSnapshot(false)
    host.manifest.set({ currentVersion: 1 } as unknown as DppManifest)
    const el = mount()
    expect(el.querySelector('dpp-verification-chip')).not.toBeNull()
  })
})
