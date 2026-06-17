/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const duration = {
  instant: 80,
  fast: 200,
  medium: 400,
  slow: 700,
} as const

// Co-ordinated reveal window. dpp-deck staggers its
// shadow-card fades across this window, and dpp-timeline
// staggers its dot reveals across the same window so the
// two stacks bloom into view together rather than racing.
export const REVEAL_TOTAL_MS = 1000

export const easing = {
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
  decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
  accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const

export const spring = {
  card: { stiffness: 0.18, damping: 0.5 },
  content: { stiffness: 0.12, damping: 0.7 },
} as const

// True when the visitor asked the OS to minimise motion.
// The CSS layer zeroes transition/animation durations, but
// JS-driven motion (WAAPI animations, smooth scrolling)
// lives outside its reach and must consult this directly.
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches
}
