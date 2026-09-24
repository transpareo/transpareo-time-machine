/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Passport levels. A publisher can issue one passport for a
 * model or a lot and a passport per unit beneath it. A link
 * to a unit with no passport of its own is answered in place
 * with the passport one level up, and the snapshot of a
 * model or lot passport names the level its unit passports
 * sit at.
 */

export type PassportLevel = 'model' | 'lot' | 'item'

export interface RequestedPassport {
  readonly level: PassportLevel
  readonly id: string
}

// Finest first, so a larger rank is a coarser passport.
const RANK: Readonly<Record<PassportLevel, number>> = {
  item: 0, lot: 1, model: 2,
}

export function levelOf(raw: unknown): PassportLevel | undefined {
  return typeof raw === 'string' && raw in RANK
    ? raw as PassportLevel : undefined
}

// What the visitor asked for. The HTML shell states it on
// the element when it answers a unit link in place; without
// that, the GS1 Digital Link qualifiers in the page path
// tell: a serial (AI 21) asks for an item, a lot (AI 10)
// for a lot.
export function requestedPassport(
  stated: { readonly level?: string; readonly id?: string },
  path: string,
): RequestedPassport | null {
  const level = levelOf(stated.level)
  if (level && stated.id) return { level, id: stated.id }
  if (stated.level) return null
  const serial = qualifier(path, '21')
  if (serial) return { level: 'item', id: serial }
  const lot = qualifier(path, '10')
  return lot ? { level: 'lot', id: lot } : null
}

function qualifier(path: string, ai: string): string | null {
  const m = path.match(new RegExp(`/${ai}/([^/?#]+)`))
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

// Whether the passport served covers more than the one
// asked for: a unit link answered by its lot or model.
export function isWalkUp(
  asked: PassportLevel, served: PassportLevel | undefined,
): boolean {
  return served !== undefined && RANK[served] > RANK[asked]
}
