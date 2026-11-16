/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What the publisher's own pages leave on the passport's
 * origin while someone is signed in there, read without
 * asking a server: the staff link its back office stores for
 * a signed-in operator (STAFF_BAR_KEY), and the cookie its
 * reader sign-in sets (READER_COOKIE). Neither names a person,
 * and the server still decides what every request may read.
 *
 * The staff link is a JSON record, both parts the back
 * office's own: `url`, the address of its lookup with
 * `{code}` where the passport's code goes, and `label`, the
 * wording of the link in the operator's language.
 */

export const STAFF_BAR_KEY = 'transpareo:passport-admin'
export const READER_COOKIE = 'transpareo_passport_reader'

export interface StaffLink {
  url: string
  label: string
}

function storedStaffValue(): string | null {
  try {
    return window.localStorage.getItem(STAFF_BAR_KEY)
  } catch {
    return null
  }
}

export function storedStaffLink(): StaffLink | null {
  return parseStaffLink(storedStaffValue())
}

// The record, or null when it lacks an address with a place
// for the code or the wording, as the bar has neither of its
// own.
export function parseStaffLink(raw: string | null): StaffLink | null {
  if (!raw) return null
  let record: unknown
  try {
    record = JSON.parse(raw)
  } catch {
    return null
  }
  if (!record || typeof record !== 'object') return null

  const { url, label } = record as Record<string, unknown>
  if (typeof url !== 'string' || !url.includes('{code}')) return null
  if (typeof label !== 'string' || !label.trim()) return null
  return { url, label: label.trim() }
}

// True while either mark stands, so a request carrying the
// session may find one. A staff link of any shape counts: it
// is there because an operator is signed in.
export function sessionHinted(): boolean {
  if (storedStaffValue()) return true
  try {
    const cookies = document.cookie.split(/;\s*/)
    return cookies.some((c) => c.startsWith(`${READER_COOKIE}=`))
  } catch {
    return false
  }
}
