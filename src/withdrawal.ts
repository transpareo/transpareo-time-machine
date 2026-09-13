/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What a published document says about its passport being
 * out of circulation, and the sentences that state it.
 * Pure functions over that document and a label set,
 * because two surfaces read the same fields: the band
 * across the top of the card (`<dpp-withdrawal>`) and the
 * standalone verifier, which would otherwise answer a
 * voided passport with nothing but "verified".
 *
 * In a versioned publication the manifest is the document
 * that carries it. A snapshot is signed once and frozen,
 * so the version on screen was written while the passport
 * still stood and still calls itself active; the manifest
 * is re-signed on every change, and its signature covers
 * these fields like any other. A DPP served as one lone
 * document has no manifest beside it and states the same
 * three keys on itself.
 */

import { canonicalVoidReason, type VoidReason } from '@/types'
import { t, type Labels, type LabelKey } from '@/i18n/labels'
import { safeLinkHref } from '@/safe-url'

export interface Withdrawal {
  readonly voidedAt: string | null
  readonly reason: VoidReason | null
  readonly successorCode: string | null

  // Where the successor can be read, when the publisher
  // states it and the scheme clears the link guard. Null
  // leaves the code as plain text: it still tells a reader
  // which passport replaced this one, and this package does
  // not guess at an address from a code.
  readonly successorUrl: string | null
}

// Any document that may state the carrier's withdrawal.
// A manifest is the one that does in ordinary publication;
// a DPP served as a lone document carries the same three
// keys on the document itself, since there is no manifest
// beside it to carry them. Everything is read defensively:
// these arrive from a publisher, not from this package.
export interface WithdrawalSource {
  readonly voidedAt?: unknown
  readonly voidedReason?: unknown
  readonly supersededBy?: unknown
}

export function withdrawalOf(
  src: WithdrawalSource | null | undefined,
): Withdrawal | null {
  if (!src) return null
  const voidedAt = typeof src.voidedAt === 'string' ? src.voidedAt : null
  const successor = objectOf(src.supersededBy)
  const successorCode = stringOf(successor?.code)
  if (!voidedAt && !successorCode) return null
  const url = stringOf(successor?.url)
  return {
    voidedAt,
    reason: voidedAt ? canonicalVoidReason(src.voidedReason) : null,
    successorCode,
    successorUrl: url ? safeLinkHref(url) : null,
  }
}

function objectOf(v: unknown): Record<string, unknown> | null {
  if (v === null || typeof v !== 'object') return null
  return v as Record<string, unknown>
}

function stringOf(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

export function withdrawalTitle(w: Withdrawal, labels: Labels): string {
  const key = w.voidedAt
    ? 'withdrawal.voided.title'
    : 'withdrawal.superseded.title'
  return t(labels, key)
}

// The sentence under the title names who withdrew the
// passport, since the statement is the issuer's and the
// card is full of their other statements. A void also
// names the day it happened: the manifest carries it, and
// it is the one date a reader may act on.
//
// The day arrives already formatted. Keeping the module
// off the i18n runtime keeps it off the signal graph the
// runtime installs, which the state layer must not drag
// in behind a derivation.
export function withdrawalBody(
  w: Withdrawal, labels: Labels, vars: WithdrawalVars,
): string {
  if (!w.voidedAt) {
    return t(labels, 'withdrawal.superseded.body', vars)
  }
  const key = `withdrawal.voided.${w.reason}` as LabelKey
  return t(labels, key, vars)
}

// A type alias, not an interface: `t()` takes a
// `Record<string, string | number>`, and only an alias
// carries the implicit index signature that satisfies it.
export type WithdrawalVars = {
  readonly issuer: string
  readonly date: string
}
