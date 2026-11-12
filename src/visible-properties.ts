/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Which scalar and link rows the page shows, from the public
 * bytes and from the rows a signed-in reader's view serves.
 * The property list draws them; the Downloads section lists
 * the files among them, so a file shows exactly while its
 * property does.
 */

import { renderedPresentation } from '@/state'
import { isShown } from '@/show-filter'
import { panelRows } from '@/private-properties'
import type { DppDocument, PropertyValue, PropertyValueOf } from '@/types'

export type ScalarRow = PropertyValueOf<'scalar'>
export type LinkRow = PropertyValueOf<'link'>
export type DetailRow = ScalarRow | LinkRow
export type DocumentRow = LinkRow & {
  value: LinkRow['value'] & { document: DppDocument }
}

// Namespaced scalar rows and every link. Tiles, badges,
// accordions, and donuts have their own renderers and pull
// the rest of the flat list. Public rows come from
// snapshot.properties; private rows arrive post-auth via the
// privateProperties endpoint and carry no `onDemand` flag,
// so the `?show=` gate passes them.
function detailRows(
  rows: ReadonlyArray<PropertyValue>,
): ReadonlyArray<DetailRow> {
  return rows
    .filter((r): r is DetailRow => r.value.type === 'link'
      || (r.value.type === 'scalar' && r.namespace != null))
    .filter(isShown)
}

// An on-demand row the reader's view serves as well shows
// once, with the served rows, whichever surface they put
// it on. `served` holds the keys of the served rows.
export function visiblePublicRows(
  served: ReadonlySet<string>
): ReadonlyArray<DetailRow> {
  return detailRows(renderedPresentation())
    .filter((r) => !r.onDemand || !served.has(r.key))
}

// A row the fold-out panels show stays out of the table:
// the public bytes may sort a served short value as a long
// text.
export function visiblePrivateRows(
  served: ReadonlyArray<PropertyValue>
): ReadonlyArray<DetailRow> {
  const panels = new Set(panelRows('longText').map((r) => r.key))
  return detailRows(served).filter((r) => !panels.has(r.key))
}

// A link that pins a file by its digest, with the file's
// details.
export function isDocumentRow(row: PropertyValue): row is DocumentRow {
  return row.value.type === 'link' && row.value.document != null
}

// A public file property without a namespace stands as a tile
// among the scalar ones, so it sits beside the properties the
// publisher listed it with.
export function isDocumentTile(row: PropertyValue): row is DocumentRow {
  return isDocumentRow(row) && row.namespace == null
}
