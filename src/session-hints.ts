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
 */

export const STAFF_BAR_KEY = 'transpareo:passport-admin'
export const READER_COOKIE = 'transpareo_passport_reader'

export function storedStaffLink(): string | null {
  try {
    return window.localStorage.getItem(STAFF_BAR_KEY)
  } catch {
    return null
  }
}

// True while either mark stands, so a request carrying the
// session may find one.
export function sessionHinted(): boolean {
  if (storedStaffLink()) return true
  try {
    const cookies = document.cookie.split(/;\s*/)
    return cookies.some((c) => c.startsWith(`${READER_COOKIE}=`))
  } catch {
    return false
  }
}
