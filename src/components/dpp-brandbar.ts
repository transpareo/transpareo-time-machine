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
import { i18n } from '@/i18n'
import { t } from '@/i18n/labels'
import { config } from '@/config'
import { safeLinkHref } from '@/safe-url'
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

    // A logo the host gave a destination for (`logo-href`,
    // typically the publisher's home page) renders as an
    // anchor. The value comes from host page markup, so it
    // passes the scheme guard first; rejected, the logo
    // stays plain artwork. With no themed logo there is
    // nothing to click, so the attribute is ignored.
    const linkTo = hasLogo && config.logoHref
      ? safeLinkHref(config.logoHref)
      : null
    const logo = linkTo
      ? '<a class="brand-logo"></a>'
      : '<span class="brand-logo"></span>'

    this.innerHTML = `
      <div class="brandbar-sentinel"></div>
      <header class="brandbar">
        ${logo}
        <span class="spacer"></span>
        ${chip}
      </header>
    `

    if (linkTo) this.linkLogo(linkTo)

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

  // The href is assigned through the DOM rather than
  // interpolated into the markup above, so a quote in the
  // configured URL cannot break out of the attribute. The
  // logo is artwork with no text, so the link would
  // otherwise announce as its own URL; the accessible name
  // sits in an effect to follow locale switches.
  private linkLogo(href: string): void {
    const a = this.querySelector('.brand-logo') as HTMLAnchorElement
    a.href = href
    this.effect(() => {
      a.setAttribute('aria-label', t(i18n.labels, 'brandbar.home'))
    })
  }
}

customElements.define('dpp-brandbar', DppBrandbar)
