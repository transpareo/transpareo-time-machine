/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Workaround for TS's recent narrowing of BufferSource:
 * `Uint8Array<ArrayBufferLike>` is not assignable where
 * `ArrayBuffer` is required, because ArrayBufferLike now
 * includes SharedArrayBuffer. The runtime values passed to
 * WebCrypto here are always plain ArrayBuffer-backed, so a
 * tight copy into a fresh ArrayBuffer is safe and matches
 * the API's runtime contract.
 */

export function asBuffer(u: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u.byteLength)
  new Uint8Array(out).set(u)
  return out
}
