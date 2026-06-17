/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * JSON reader that tolerates gzip delivery. The CDN stores
 * snapshots / EPCIS / library docs gzipped. When it serves
 * them with `Content-Encoding: gzip` the browser has
 * already decompressed by the time we read the body, so the
 * bytes parse directly. Objects published before that
 * header was added can still arrive as raw gzip with no
 * header; this detects the gzip magic bytes and inflates
 * them with the native DecompressionStream (no dependency,
 * supported in every engine that has WebCrypto Ed25519).
 */

// Inflated-size cap for the header-less gzip path. The
// artefacts read through here (manifest, snapshots, EPCIS,
// library docs) are tens of kilobytes; anything inflating
// past this is a gzip bomb from a compromised origin, not
// data, and is aborted instead of hanging the tab.
const MAX_INFLATED_BYTES = 10 * 1024 * 1024

export async function readJsonResponse<T>(res: Response): Promise<T> {
  return JSON.parse(await readTextResponse(res)) as T
}

// Body text with the same header-less-gzip tolerance, for
// callers that sniff the payload shape before parsing it
// (the verifier widget accepts both a JSON manifest and an
// HTML passport page on one input).
export async function readTextResponse(res: Response): Promise<string> {
  const buf = await res.arrayBuffer()
  return isGzip(buf)
    ? gunzip(buf)
    : new TextDecoder().decode(buf)
}

// gzip streams start with the magic bytes 0x1f 0x8b.
function isGzip(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 2) return false
  const head = new Uint8Array(buf, 0, 2)
  return head[0] === 0x1f && head[1] === 0x8b
}

async function gunzip(buf: ArrayBuffer): Promise<string> {
  const stream = new Response(buf).body!
    .pipeThrough(new DecompressionStream('gzip'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_INFLATED_BYTES) {
      await reader.cancel()
      throw new Error(
        `gzip body inflates past ${MAX_INFLATED_BYTES} bytes`,
      )
    }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(joined)
}
