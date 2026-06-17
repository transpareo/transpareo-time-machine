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
}

export function colorForEventType(eventType: string): string {
  return TYPE_COLORS[eventType] || 'var(--color-muted)'
}
