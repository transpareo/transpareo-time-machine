/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-brandbar>, sticky header at the top of the live
 * card. A zero-height sentinel above the bar lets an
 * IntersectionObserver flip the `.stuck` class
 * (translucent background + bottom divider) once the
 * page has scrolled past the bar's resting position.
 *
 * `display: contents` (in the scss) hides the host box
 * from layout so the sentinel + sticky bar are direct
 * children of the parent card, needed for sticky to
 * resolve against the card, not against this element.
 */

import { LightElement } from '@/reactive/element'
import { verificationMarkVisible } from '@/state'
import './dpp-verification-chip'

class DppBrandbar extends LightElement {
  protected setup(): void {
    // Chip visibility policy lives in state.ts
    // (verificationMarkVisible): explicit attribute wins,
    // and a lone unsigned snapshot hides the chip by
    // default. Read once; the publication shape cannot
    // change within a mounted tree.
    const chip = verificationMarkVisible()
      ? '<dpp-verification-chip></dpp-verification-chip>'
      : ''

    // Nothing to show: the theme names no logo and the
    // host suppressed the chip. Render no bar at all,
    // since an empty sticky header is just whitespace.
    const logoUrl = getComputedStyle(this)
      .getPropertyValue('--logo-url')
      .trim()
    const hasLogo = logoUrl !== '' && logoUrl !== 'none'
    if (!hasLogo && !chip) return

    this.innerHTML = `
      <div class="brandbar-sentinel"></div>
      <header class="brandbar">
        <span class="brand-logo"></span>
        <span class="spacer"></span>
        ${chip}
      </header>
    `

    const sentinel = this.querySelector('.brandbar-sentinel')!
    const bar = this.querySelector('.brandbar')!

    // If the host theme defines --logo-color, switch the
    // logo to mask-tinted rendering so the SVG silhouette
    // gets recoloured to that value. Without the variable
    // the .brand-logo keeps its original `background-image`
    // (preserving the SVG's intrinsic colours). Read from
    // the element itself rather than documentElement so the
    // full cascade applies (the host may set the variable
    // on body or anywhere upstream).
    const themeLogoColor = getComputedStyle(this)
      .getPropertyValue('--logo-color')
      .trim()
    if (themeLogoColor) this.classList.add('logo-tinted')

    const obs = new IntersectionObserver(([entry]) => {
      bar.classList.toggle('stuck', !entry.isIntersecting)
    }, { threshold: 0 })

    obs.observe(sentinel)
    this.effect(() => () => obs.disconnect())
  }
}

customElements.define('dpp-brandbar', DppBrandbar)
