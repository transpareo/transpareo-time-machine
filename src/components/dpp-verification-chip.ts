/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-verification-chip>, small pill that surfaces
 * the active version's verification state (pending /
 * verified / failed). Click opens the proof modal.
 */

import { LightElement } from '@/reactive/element'
import { verifyResult, activePlatform } from '@/state'
import { proofModalOpen } from './dpp-verification-modal'
import { t, type LabelKey } from '@/i18n/labels'
import { i18n } from '@/i18n'

const VIEW = {
  pending: { cls: 'verifying', label: 'verifying' as LabelKey },
  verified: { cls: 'verified', label: null },
  failed: { cls: 'failed', label: 'verificationFailed' as LabelKey },
  draft: { cls: 'draft', label: 'notPublished' as LabelKey },
} as const

class DppVerificationChip extends LightElement {
  protected setup(): void {
    this.innerHTML = `
      <button type="button" class="chip clickable">
        <span class="orb">
          <span class="orb-icon">
            <svg class="icon icon--fn spinner" aria-hidden="true">
              <use href="#spinner"/>
            </svg>
            <svg class="icon icon--fn check" aria-hidden="true">
              <use href="#icon-ok"/>
            </svg>
            <svg class="icon icon--fn x" aria-hidden="true">
              <use href="#icon-cancel"/>
            </svg>
            <svg class="icon icon--fn info" aria-hidden="true">
              <use href="#icon-info"/>
            </svg>
          </span>
          <span class="ripple" aria-hidden="true"></span>
        </span>
        <span class="label-text"></span>
      </button>
    `

    const btn = this.querySelector('.chip') as HTMLButtonElement
    const lbl = this.querySelector('.label-text')!

    // A draft is unsigned by design, so there is no proof
    // chain to open: the chip stays inert (no pointer, no
    // modal) in that state.
    btn.addEventListener('click', () => {
      if (verifyResult() === 'draft') return
      proofModalOpen.set(true)
    })

    this.effect(() => {
      const r = verifyResult()
      const v = VIEW[r]
      const text = v.label != null
        ? t(i18n.labels, v.label)
        : verifiedLabel()
      const clickable = r === 'draft' ? '' : ' clickable'
      btn.className = `chip${clickable} state-${v.cls}`
      btn.setAttribute('aria-label', text)
      lbl.textContent = text
    })
  }
}

// "Verified by <PlatformName>" when the manifest carries
// a platform name; the bare "Verified" otherwise (no
// fabricated brand attribution).
function verifiedLabel(): string {
  const name = activePlatform().name
  if (name) return t(i18n.labels, 'verifiedByPlatform', { name })
  return t(i18n.labels, 'verified')
}

customElements.define('dpp-verification-chip', DppVerificationChip)
