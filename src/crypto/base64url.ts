/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Multibase (RFC draft) base64url decode for the `u`
 * prefix variant, the unpadded base64url alphabet.
 *
 * Where base58 (`z`, ./multibase.ts) carries the
 * eddsa-jcs-2022 signatures and Multikey public keys,
 * base64url (`u`) carries the ecdsa-sd-2023 proofValue:
 * a CBOR structure the browser verifier decodes back to
 * bytes (base, per-statement signatures, the label map)
 * before checking them. The encoder is verify-side too:
 * a derived proof's compressed label map holds raw HMAC
 * bytes, and reproducing the exact N-Quads the issuer
 * signed means re-encoding them to the same `u...` labels.
 */

// Standard base64url alphabet (RFC 4648 §5): '+' and '/'
// of base64 replaced by '-' and '_', and no '=' padding.
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

// Reverse lookup: char code -> 6-bit value, -1 for any
// byte that is not an alphabet character.
const LOOKUP = buildLookup()

export function decodeMultibaseBase64url(multibase: string): Uint8Array {
  if (multibase.length === 0 || multibase[0] !== 'u') {
    throw new Error('not a u-prefixed multibase string')
  }
  return decodeBase64url(multibase.slice(1))
}

// Encode bytes to unpadded base64url (no `u` multibase
// prefix): three bytes to four chars, with a two- or
// three-char tail for the final one or two bytes.
export function encodeBase64url(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63]
      + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63]
  }
  const rem = bytes.length - i
  if (rem === 1) {
    const n = bytes[i] << 16
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63]
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63]
      + ALPHABET[(n >> 6) & 63]
  }
  return out
}

function decodeBase64url(s: string): Uint8Array {
  if (s.length === 0) return new Uint8Array(0)

  // A length of exactly 1 mod 4 is impossible for base64:
  // no group of 6-bit digits produces a partial byte that
  // short, so it can only be corruption or stray padding.
  if (s.length % 4 === 1) {
    throw new Error('invalid base64url length')
  }

  // Four 6-bit chars make three bytes; a trailing group of
  // two chars makes one byte, three chars make two. Size
  // the output from the char count and its remainder.
  const groups = s.length >> 2
  const rem = s.length & 3
  const outLen = groups * 3 + (rem === 0 ? 0 : rem - 1)
  const out = new Uint8Array(outLen)

  let o = 0
  let acc = 0
  let bits = 0
  for (let i = 0; i < s.length; i++) {
    const v = LOOKUP[s.charCodeAt(i)]
    if (v < 0) throw new Error(`invalid base64url char: ${s[i]}`)
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  return out
}

function buildLookup(): Int8Array {
  const table = new Int8Array(128).fill(-1)
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i
  }
  return table
}
