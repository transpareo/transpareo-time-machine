/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The travel from the host page's first frame into the
 * passport.
 *
 * A host page paints something before this element has any
 * data - typically the product picture it already knows.
 * That first frame is the host's own composition and it is
 * not this card: it has no verdict to show yet, so dressing
 * it as a verified passport would claim something nothing
 * has checked. It is laid out wherever its author wanted it.
 *
 * Rather than asking hosts to match measurements they would
 * then have to track, the renderer measures both: where the
 * host's picture is at the moment of mount, where this
 * card's picture lands, and animates the difference away.
 * Nothing is shared between the two layouts, so nothing can
 * drift, and a host that moves its first frame gets a
 * correct travel without telling anyone.
 */

// Below this the candidate is an icon or a logo rather than
// the product picture the first frame was built around.
const MIN_TRAVELLER = 40

const DURATION_MS = 520

// Decelerating: fast off the mark, settling rather than
// arriving. A linear travel of this length reads as a slide.
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

// The picture the host page is showing right now. The
// largest one it has painted, since a first frame that
// carries a logo as well is showing the product picture at
// the larger of the two.
export function travellerRect(host: Element): DOMRect | null {
  let best: DOMRect | null = null
  for (const img of host.querySelectorAll('img')) {
    const rect = img.getBoundingClientRect()
    if (rect.width < MIN_TRAVELLER) continue
    if (!best || rect.width > best.width) best = rect
  }
  return best
}

// The transform that would put `to` back where `from` was.
// Origin is the top left corner, so the scale multiplies
// out from there and the translation is a plain corner
// delta.
export function invert(from: DOMRect, to: DOMRect): string | null {
  if (!to.width || !from.width) return null
  const dx = Math.round((from.left - to.left) * 100) / 100
  const dy = Math.round((from.top - to.top) * 100) / 100
  const scale = Math.round((from.width / to.width) * 1000) / 1000

  // Nothing worth watching, and a transform this small
  // reads as a flicker rather than a move.
  const moved = Math.abs(dx) > 1 || Math.abs(dy) > 1
  const resized = Math.abs(scale - 1) > 0.01
  if (!moved && !resized) return null
  return `translate(${dx}px, ${dy}px) scale(${scale})`
}

// Play the card's picture back to where the host's was and
// let it travel in. Runs after a frame so the card has been
// laid out and its rect is real.
export function playHandover(host: Element, from: DOMRect): void {
  const reduced = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches
  if (reduced) return

  requestAnimationFrame(() => {
    const target = host.shadowRoot?.querySelector('.dpp-hero-image')
    if (!(target instanceof HTMLElement)) return

    const transform = invert(from, target.getBoundingClientRect())
    if (!transform) return

    // Set on the element rather than in the keyframes: an
    // origin animated alongside the transform it governs
    // moves the reference frame mid-travel.
    target.style.transformOrigin = 'top left'
    const played = target.animate(
      [{ transform }, { transform: 'none' }],
      { duration: DURATION_MS, easing: EASING }
    )
    played.finished
      .catch(() => undefined)
      .finally(() => { target.style.transformOrigin = '' })
  })
}
