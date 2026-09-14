/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-withdrawal>, the band across the top of the card
 * for a passport that is out of circulation: voided (the
 * unit it described is gone) or superseded (another
 * passport carries the unit now).
 *
 * It renders nothing at all for a passport that stands,
 * which is nearly all of them, so the state is read once
 * at mount the way the brandbar reads its own: the
 * manifest cannot change under a mounted tree, and a new
 * `src` mounts a fresh one.
 *
 * The band does not follow the timeline. Scrubbing back
 * to a version published while the unit was still in
 * circulation shows that version's content, and the unit
 * is still out of circulation while the visitor reads it,
 * so the band states the same thing over every version.
 *
 * Its palette is the card's own, swapped: the card's ink
 * as ground, the card's ground as text, whichever way the
 * publisher's theme runs. Not the verification red, which
 * in this renderer means a proof that did not check out.
 * A voided passport's proofs usually verify perfectly, and
 * a red band beside a green chip would read as a broken
 * document rather than a closed one.
 *
 * It carries no glyph. One sat in front of the text and
 * pushed the whole block out of the card's column, so the
 * band's sentences lined up with nothing else on the page;
 * an inverted slab under the logo needs no help being
 * noticed, and the title says which state this is.
 */

import { LightElement } from '@/reactive/element'
import { html } from '@/reactive/html'
import { withdrawal, activeIssuer } from '@/state'
import {
  withdrawalTitle, withdrawalBody,
  type Withdrawal, type WithdrawalVars,
} from '@/withdrawal'
import { i18n, formatLongDate } from '@/i18n'
import { t } from '@/i18n/labels'
import type { Organization } from '@/archive'

class DppWithdrawal extends LightElement {
  protected setup(): void {
    const state = withdrawal()
    if (!state) return

    const tpl = html`
      <section class="withdrawal" role="status">
        <p class="withdrawal-title">
          ${() => withdrawalTitle(state, i18n.labels)}
        </p>
        <p class="withdrawal-body">
          ${() => withdrawalBody(state, i18n.labels, sentenceVars(state))}
        </p>
        <p class="withdrawal-successor"
           ?hidden=${!state.successorCode}>
          <span class="withdrawal-successor-label">
            ${() => t(i18n.labels, 'withdrawal.successor')}
          </span>
          <a class="withdrawal-code"
             href=${state.successorUrl ?? undefined}>${
            state.successorCode ?? ''
          }</a>
        </p>
      </section>
    `
    tpl.mount(this, this.effect.bind(this))
  }
}

// Who the statement belongs to and the day it was made,
// read inside the binding so both follow a locale switch.
//
// The issuer comes off the snapshot rather than the
// manifest. They name the same publisher wherever there is
// a manifest, and a DPP served as a lone document has only
// this one - reading the manifest there left the sentence
// with a hole where the publisher should be. The block is
// read defensively because a foreign document may carry
// no issuer at all.
function sentenceVars(state: Withdrawal): WithdrawalVars {
  const org: Organization | undefined = activeIssuer()
  return {
    issuer: org?.name ?? '',
    date: state.voidedAt
      ? formatLongDate(state.voidedAt, i18n.locale)
      : '',
  }
}

customElements.define('dpp-withdrawal', DppWithdrawal)
