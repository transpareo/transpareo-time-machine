/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Single source of truth for the per-event-type colour
 * tokens, used by both the timeline (dots, connectors,
 * card accents) and the bottom banner (event-type tag),
 * so the colour the user sees on a dot matches the
 * colour they read on the banner that dot summons.
 */

// The timeline's own ink and ground: the colours its cards
// are written in, which are the card's own unless the
// publisher gave the timeline a palette of its own.
const TIMELINE_INK = 'var(--timeline-card-text, var(--font-color))'
const TIMELINE_GROUND =
  'var(--timeline-card-background, var(--background-color))'

const TYPE_COLORS: Record<string, string> = {
  published: 'var(--timeline-event-published)',
  registered_with_eu: 'var(--timeline-event-published)',
  recalled: 'var(--color-verify-fail)',
  rolled_back: 'var(--color-verify-fail)',
  lifecycle_transition: 'var(--timeline-event-use)',
  inspection: 'var(--timeline-event-collected)',
  repair: 'var(--timeline-event-repair)',
  refurbished: 'var(--timeline-event-refurbished)',
  collected: 'var(--timeline-event-collected)',
  recycled: 'var(--timeline-event-recycled)',

  // Passport-record events, keyed to what they do to the
  // record. Voiding and superseding take the passport out of
  // circulation and wear the withdrawal band's inverted ink,
  // kept off the verification red because their proofs
  // usually verify; a reissue mints a fresh passport, and a
  // correction repairs the data in place.
  voided: TIMELINE_INK,
  superseded: TIMELINE_INK,
  reissued: 'var(--timeline-event-published)',
  corrected: 'var(--timeline-event-repair)',
}

// The pill text on an ink-coloured pill is the ground it
// was swapped with; every other pill keeps the publisher's
// pill text token.
const TEXT_COLORS: Record<string, string> = {
  voided: TIMELINE_GROUND,
  superseded: TIMELINE_GROUND,
}

export function colorForEventType(eventType: string): string {
  return TYPE_COLORS[eventType] || 'var(--color-muted)'
}

// Sets both colours on the element a dot, connector, card
// or modal grid hangs off; `.event-tag` inside reads them.
export function paintEvent(
  node: HTMLElement | SVGElement, eventType: string
): void {
  const text = TEXT_COLORS[eventType] || 'var(--timeline-event-text, #fff)'
  node.style.setProperty('--event-color', colorForEventType(eventType))
  node.style.setProperty('--event-text-color', text)
}
