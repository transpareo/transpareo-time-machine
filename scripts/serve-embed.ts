/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Static server for the embed smoke test
 * (tests/embed-smoke.spec.ts). Serves a minimal host page
 * at `/` that loads ONLY the built single-file embed bundle
 * (dist-embed/embed.js) and its locale chunks, with no
 * stylesheet of its own. That lets the test prove the bundle
 * registers the custom element and injects its own CSS.
 *
 * Build/test scaffolding only; nothing at runtime uses it.
 * Run: npm run serve:embed (after npm run build:embed).
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { join, extname } from 'node:path'

const PORT = Number(process.env.EMBED_SMOKE_PORT ?? 5175)
const DIST = fileURLToPath(new URL('../dist-embed', import.meta.url))

const PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /></head>
  <body>
    <transpareo-time-machine></transpareo-time-machine>
    <script type="module" src="/embed.js"></script>
  </body>
</html>
`

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  if (path === '/' || path === '/index.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(PAGE)
    return
  }

  // Serve only built embed assets from dist-embed; reject
  // anything that resolves outside it.
  const file = join(DIST, path)
  if (!file.startsWith(DIST)) {
    res.statusCode = 403
    res.end('forbidden')
    return
  }
  readFile(file)
    .then((buf) => {
      res.setHeader(
        'Content-Type',
        CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      )
      res.end(buf)
    })
    .catch(() => {
      res.statusCode = 404
      res.end('not found')
    })
})

server.listen(PORT, () => {
  console.log(`embed smoke server: http://localhost:${PORT}/`)
})
