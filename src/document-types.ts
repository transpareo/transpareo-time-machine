/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The code list a pinned file's type is drawn from. A module
 * of its own, importing nothing, so the seed scripts read the
 * same list the renderer labels.
 */

// Absolute for the reason REGION_DATATYPE is (src/types.ts),
// and a v2 term: the second edition of the vocabulary added
// it with downloads.
export const DOCUMENT_TYPE_DATATYPE =
  'https://transpareo.com/vocab/transpareo/v2#document-type'

// Every code of that list, each with a `documentType.*`
// label in every locale. A code this package has never heard
// of reads as `other`, as an unknown void reason does.
export const DOCUMENT_TYPES = [
  'certificate',
  'declaration_of_conformity',
  'test_report',
  'manual',
  'safety_data_sheet',
  'other'
] as const

export type DocumentType = typeof DOCUMENT_TYPES[number]
