/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Multibase (RFC draft) base58btc encode/decode for the
 * `z` prefix variant. Used on both sides of the proof
 * flow:
 *   - The seed signer encodes the issuer + platform
 *     Ed25519 public keys into Multikey strings, and
 *     the per-signature bytes into proofValue strings.
 *   - The browser verifier decodes both back to bytes
 *     before calling crypto.subtle.verify.
 *
 * Bitcoin alphabet, no checksum. Leading zero bytes are
 * preserved as leading '1' characters per the standard.
 */

const ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function encodeMultibaseBase58(bytes: Uint8Array): string {
  return 'z' + encodeBase58(bytes)
}

export function decodeMultibaseBase58(multibase: string): Uint8Array {
  if (multibase.length === 0 || multibase[0] !== 'z') {
    throw new Error('not a z-prefixed multibase string')
  }
  return decodeBase58(multibase.slice(1))
}

function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''

  // Count leading zero bytes; each maps to a leading '1'
  // in the encoded form.
  let leadingZeros = 0
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) {
    leadingZeros++
  }

  // Base-256 -> base-58 conversion. Work on a copy so we
  // don't mutate the caller's buffer.
  const digits: number[] = []
  for (let i = leadingZeros; i < bytes.length; i++) {
    let carry = bytes[i]
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }

  let out = ''
  for (let i = 0; i < leadingZeros; i++) out += '1'
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]]
  return out
}

function decodeBase58(s: string): Uint8Array {
  if (s.length === 0) return new Uint8Array(0)
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const digit = ALPHABET.indexOf(c)
    if (digit < 0) throw new Error(`invalid base58 char: ${c}`)
    let carry = digit
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  for (let i = 0; i < s.length && s[i] === '1'; i++) bytes.push(0)
  return new Uint8Array(bytes.reverse())
}
