/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Rating -> smiley icon. The renderer expresses a
 * sustainability rating as a small face glyph from the
 * shared icon sprite (id `icon-rating-<level>`), so the
 * shape is uniform across browsers and the colour follows
 * the `.icon-rating-<level>` class declared in
 * dpp-library-modal.scss.
 */

import type { Rating } from '@/types'
import { icon } from '@/icons'
import { el } from '@/reactive/dom'
import { i18n } from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'

// Map our Rating enum onto the sprite's existing
// kebab-case smiley ids (`icon-smiley-very-bad`, etc.).
// CSS in dpp-library-modal.scss colours each glyph via
// the `.icon-smiley-*` class the icon helper applies.
const SPRITE_NAME: Record<Rating, string> = {
  veryBad: 'smiley-very-bad',
  bad: 'smiley-bad',
  neutral: 'smiley-neutral',
  good: 'smiley-good',
  veryGood: 'smiley-very-good',
}

export function ratingIcon(rating: Rating): SVGSVGElement {
  return icon(SPRITE_NAME[rating])
}

// Generic "<label>: <value>" presentation row. Shared
// by the hero (product rating), the library modal lead
// (share + component rating), and any future rows that
// want the same compact key/value look. Surrounding
// margins are set by the host block's own SCSS.
export function buildKvRow(
  label: string,
  ...value: Array<string | Node>
): HTMLElement {
  const row = el('div', 'dpp-rating-row')
  row.append(el('span', 'dpp-rating-label', `${label}:`))
  const valueEl = el('span', 'dpp-rating-value')
  valueEl.append(...value)
  row.append(valueEl)
  return row
}

export function buildRatingRow(rating: Rating): HTMLElement {
  return buildKvRow(
    t(i18n.labels, 'product.rating'),
    ratingIcon(rating),
    t(i18n.labels, `rating.${rating}` as LabelKey),
  )
}
