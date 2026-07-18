/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Verify-only CBOR decoder (RFC 8949), scoped to the
 * subset the ecdsa-sd-2023 proofValue uses: unsigned
 * integers, byte strings, text strings, arrays, integer-
 * keyed maps, and tags. That covers a base proof
 *   tag(0xd95d00) [ baseSignature, publicKey, hmacKey,
 *                   signatures[], mandatoryPointers[] ]
 * and a derived proof
 *   tag(0xd95d01) [ baseSignature, publicKey, signatures[],
 *                   labelMap{int:int}, mandatoryIndexes[] ].
 *
 * Everything outside that subset (negative integers,
 * floats, booleans, null, indefinite-length items) is
 * rejected rather than guessed at: a proofValue that
 * carries them is malformed for our purpose, and a
 * verifier should fail closed on input it does not fully
 * understand. There is no encoder; the SPA never issues.
 */

export interface CborTag {
  readonly tag: number
  readonly value: CborValue
}

export type CborValue =
  | number
  | Uint8Array
  | string
  | ReadonlyArray<CborValue>
  | ReadonlyMap<number, CborValue>
  | CborTag

// Major types (RFC 8949 §3.1), the high 3 bits of the
// initial byte. Types 1 (negative int) and 7 (float /
// simple) are intentionally unsupported.
const MAJOR_UINT = 0
const MAJOR_BYTES = 2
const MAJOR_TEXT = 3
const MAJOR_ARRAY = 4
const MAJOR_MAP = 5
const MAJOR_TAG = 6

interface Reader {
  readonly view: DataView
  readonly bytes: Uint8Array
  pos: number
}

// Decode exactly one CBOR item from `bytes` and require
// that it consumes the whole input; trailing bytes are a
// decode error, not ignored padding.
export function decodeCbor(bytes: Uint8Array): CborValue {
  const r: Reader = {
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    bytes,
    pos: 0,
  }
  const value = readItem(r)
  if (r.pos !== bytes.length) {
    throw new Error(
      `trailing bytes after CBOR item (${r.pos} of ${bytes.length})`,
    )
  }
  return value
}

function readItem(r: Reader): CborValue {
  const initial = readUint8(r)
  const major = initial >> 5
  const info = initial & 0x1f
  switch (major) {
    case MAJOR_UINT:
      return readLength(r, info)
    case MAJOR_BYTES:
      return readBytes(r, readLength(r, info))
    case MAJOR_TEXT:
      return readText(r, readLength(r, info))
    case MAJOR_ARRAY:
      return readArray(r, readLength(r, info))
    case MAJOR_MAP:
      return readMap(r, readLength(r, info))
    case MAJOR_TAG:
      return { tag: readLength(r, info), value: readItem(r) }
    default:
      throw new Error(`unsupported CBOR major type ${major}`)
  }
}

// Decode the argument that follows an initial byte: a
// small value inline (0..23), or 1/2/4/8 big-endian bytes
// for 24/25/26/27. Indefinite length (31) and the
// reserved 28..30 are rejected. Values wider than 53 bits
// cannot round-trip through a JS number and are rejected.
function readLength(r: Reader, info: number): number {
  if (info < 24) return info
  if (info === 24) return readUint8(r)
  if (info === 25) return readUint16(r)
  if (info === 26) return readUint32(r)
  if (info === 27) return readUint64(r)
  throw new Error(`unsupported CBOR additional-info ${info}`)
}

function readArray(r: Reader, count: number): CborValue[] {
  const out: CborValue[] = new Array(count)
  for (let i = 0; i < count; i++) out[i] = readItem(r)
  return out
}

// Integer-keyed maps only (the label map). A non-integer
// key or a duplicate key is rejected: the label map must
// decode deterministically for the signature check.
function readMap(r: Reader, count: number): Map<number, CborValue> {
  const out = new Map<number, CborValue>()
  for (let i = 0; i < count; i++) {
    const key = readItem(r)
    if (typeof key !== 'number') {
      throw new Error('CBOR map key is not an integer')
    }
    if (out.has(key)) throw new Error(`duplicate CBOR map key ${key}`)
    out.set(key, readItem(r))
  }
  return out
}

function readBytes(r: Reader, len: number): Uint8Array {
  requireAvailable(r, len)
  const out = r.bytes.slice(r.pos, r.pos + len)
  r.pos += len
  return out
}

function readText(r: Reader, len: number): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(readBytes(r, len))
}

function readUint8(r: Reader): number {
  requireAvailable(r, 1)
  return r.view.getUint8(r.pos++)
}

function readUint16(r: Reader): number {
  requireAvailable(r, 2)
  const v = r.view.getUint16(r.pos)
  r.pos += 2
  return v
}

function readUint32(r: Reader): number {
  requireAvailable(r, 4)
  const v = r.view.getUint32(r.pos)
  r.pos += 4
  return v
}

function readUint64(r: Reader): number {
  requireAvailable(r, 8)
  const v = r.view.getBigUint64(r.pos)
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('CBOR integer exceeds safe range')
  }
  r.pos += 8
  return Number(v)
}

function requireAvailable(r: Reader, n: number): void {
  if (r.pos + n > r.bytes.length) {
    throw new Error('unexpected end of CBOR input')
  }
}
