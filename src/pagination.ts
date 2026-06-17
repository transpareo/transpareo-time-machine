/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `getPages(current, total)`, produces the numbered
 * pagination layout (e.g. `1 ... 4 5 6 ... 9`) used by
 * the gallery. Honours a 7-item visible cap.
 */

export type Page = number | '...'

export function getPages(
  currentPage: number,
  totalPages: number,
): Page[] {
  const maxVisible = 7
  const pages: Page[] = []
  if (totalPages <= 1) return pages

  // totalPages >= 2 here (the <= 1 case returned above), so
  // first and last are always distinct.
  pages.push(1)
  pages.push(totalPages)

  let start = Math.max(2, currentPage - 2)
  let end = Math.min(totalPages - 1, currentPage + 2)

  let available = maxVisible - pages.length
    - (start > 2 ? 1 : 0)
    - (end < totalPages - 1 ? 1 : 0)

  while (end - start + 1 > available) {
    if (currentPage - start < end - currentPage) end--
    else start++
    available = maxVisible - pages.length
      - (start > 2 ? 1 : 0)
      - (end < totalPages - 1 ? 1 : 0)
  }

  for (let i = start; i <= end; i++) {
    pages.splice(pages.length - 1, 0, i)
  }

  if (start > 2) pages.splice(1, 0, '...')
  if (end < totalPages - 1) {
    pages.splice(pages.length - 1, 0, '...')
  }

  const len = pages.length
  if (len < maxVisible) {
    let toAdd = maxVisible - len
    while (toAdd > 0) {
      if (end < totalPages - 1) {
        end++
        const ri = pages.lastIndexOf('...')
        if (ri !== -1) pages.splice(ri, 0, end)
        else pages.splice(pages.length - 1, 0, end)
        toAdd--
        if (
          end === totalPages - 1
          && pages.indexOf('...') !== -1
        ) {
          pages.splice(pages.lastIndexOf('...'), 1)
        }
      } else if (start > 2) {
        start--
        const li = pages.indexOf('...')
        if (li !== -1) pages.splice(li + 1, 0, start)
        else pages.splice(1, 0, start)
        toAdd--
        if (
          start === 2
          && pages.indexOf('...') !== -1
        ) {
          pages.splice(pages.indexOf('...'), 1)
        }
      } else break
    }
  }

  if (pages.indexOf('...') !== -1) {
    const leftEll = pages.indexOf('...')
    if (leftEll !== -1 && start === 3) {
      start--
      pages.splice(leftEll + 1, 0, start)
      if (start === 2) pages.splice(leftEll, 1)
    }
    const rightEll = pages.lastIndexOf('...')
    if (rightEll !== -1 && end === totalPages - 2) {
      end++
      pages.splice(rightEll, 0, end)
      if (end === totalPages - 1) {
        pages.splice(rightEll + 1, 1)
      }
    }
  }

  return pages
}
