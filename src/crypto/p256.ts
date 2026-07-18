/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * P-256 (secp256r1) ECDSA verification for the
 * ecdsa-sd-2023 cryptosuite, over the platform WebCrypto.
 *
 * Two shapes of key arrive in an ecdsa-sd proof, both as
 * compressed points:
 *   - the issuer key, resolved from the verificationMethod
 *     as a P-256 Multikey (multicodec 0x8024 || 33-byte
 *     compressed point);
 *   - the proof-scoped ephemeral key, carried in the
 *     proofValue as the 35-byte Multikey bytes.
 * WebCrypto's importKey('raw', ...) accepts only the
 * 65-byte uncompressed encoding, so we decompress the
 * point ourselves (P-256's field prime is 3 mod 4, so the
 * square root is a single modular exponentiation). Unlike
 * Ed25519, ECDSA P-256 is universally available in
 * crypto.subtle, so there is no vendored curve fallback.
 *
 * Signatures are the raw r || s form (64 bytes), which is
 * what both the base signature and the per-statement
 * signatures use; no DER wrapping.
 */

import { asBuffer } from './buffer'

// secp256r1 field prime, curve coefficients, and the
// (p + 1) / 4 exponent used for the square root.
const P =
  0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn
const A = P - 3n
const B =
  0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn
const SQRT_EXP = (P + 1n) / 4n

// Multicodec varint for p256-pub (0x1200), prefixing a
// 33-byte compressed point in a Multikey.
const P256_MULTIKEY_PREFIX = Uint8Array.of(0x80, 0x24)

const ECDSA_VERIFY = { name: 'ECDSA', hash: 'SHA-256' } as const
const P256_KEY = { name: 'ECDSA', namedCurve: 'P-256' } as const

// Import a P-256 public key for verification. Accepts the
// 65-byte uncompressed form, the 33-byte compressed form,
// or the 35-byte P-256 Multikey (0x8024 prefix); the
// compressed forms are decompressed first.
export async function importP256PublicKey(
  key: Uint8Array,
): Promise<CryptoKey> {
  // Decompression rejects malformed keys synchronously;
  // awaiting inside an async function turns those throws
  // into a rejected promise, so every failure path is a
  // rejection the caller handles uniformly.
  const uncompressed = toUncompressed(key)
  return crypto.subtle.importKey(
    'raw', asBuffer(uncompressed), P256_KEY, false, ['verify'],
  )
}

// Verify a raw (r || s, 64-byte) ECDSA/SHA-256 signature.
export function verifyP256(
  key: CryptoKey, signature: Uint8Array, message: Uint8Array,
): Promise<boolean> {
  if (signature.length !== 64) return Promise.resolve(false)
  return crypto.subtle.verify(
    ECDSA_VERIFY, key, asBuffer(signature), asBuffer(message),
  )
}

function toUncompressed(key: Uint8Array): Uint8Array {
  if (key.length === 65) {
    if (key[0] !== 0x04) throw new Error('malformed uncompressed P-256 point')
    return key
  }
  if (key.length === 35) {
    if (key[0] !== P256_MULTIKEY_PREFIX[0]
      || key[1] !== P256_MULTIKEY_PREFIX[1]) {
      throw new Error('not a P-256 Multikey (expected 0x8024 prefix)')
    }
    return decompressPoint(key.subarray(2))
  }
  if (key.length === 33) return decompressPoint(key)
  throw new Error(`unexpected P-256 key length ${key.length}`)
}

// Recover the full point from a 33-byte compressed
// encoding (0x02/0x03 parity byte || X). Rejects a byte
// that is not a valid parity prefix, an X outside the
// field, and an X for which no square root exists (the
// point is not on the curve).
function decompressPoint(compressed: Uint8Array): Uint8Array {
  const prefix = compressed[0]
  if (prefix !== 0x02 && prefix !== 0x03) {
    throw new Error('malformed compressed P-256 point')
  }
  const x = bytesToBigInt(compressed.subarray(1))
  if (x >= P) throw new Error('compressed P-256 X out of field range')

  const rhs = (x * x * x + A * x + B) % P
  let y = modPow(rhs, SQRT_EXP, P)
  if ((y * y) % P !== rhs) {
    throw new Error('compressed P-256 point is not on the curve')
  }

  // Pick the root whose parity matches the prefix (0x03 is
  // odd), flipping to p - y when it does not.
  const wantOdd = prefix === 0x03
  if ((y & 1n) === 1n !== wantOdd) y = P - y

  const out = new Uint8Array(65)
  out[0] = 0x04
  out.set(bigIntToBytes(x, 32), 1)
  out.set(bigIntToBytes(y, 32), 33)
  return out
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  let b = base % mod
  let e = exp
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod
    b = (b * b) % mod
    e >>= 1n
  }
  return result
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n
  for (const byte of bytes) v = (v << 8n) | BigInt(byte)
  return v
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length)
  let v = value
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}
