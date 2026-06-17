/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Embed entry, the script-tag delivery shape. Built by
 * `npm run build:embed` into a single ES module
 * (`dist-embed/embed.js`) that a host page integrates
 * with one line:
 *
 *   <transpareo-time-machine src="..."></transpareo-time-machine>
 *   <script type="module" src=".../embed.js"></script>
 *
 * The host serves `/branding.css` for the publisher
 * theme tokens (logo colour, headline font, etc.); see
 * index.html for the dev shape. Everything else - the
 * SPA's structural stylesheet, custom-element
 * registrations, every component module - is bundled in
 * the one file the <script> tag points at.
 *
 * Why this exists alongside main.ts: main.ts is the
 * bundler entry. It does `import './styles/app.css'`, a
 * plain import that vite's lib mode extracts into a
 * sibling `transpareo-time-machine.css`. A bundler
 * consumer wants that, they need the stylesheet as an
 * asset they can fingerprint and reorder alongside
 * their own CSS. A no-build embedder does NOT want
 * that, they would need a second <link rel="stylesheet">
 * in the right place in the document head and an FOUC
 * is one missed step away.
 *
 * The `?inline` query on the CSS import (below) returns
 * the stylesheet as a string instead of emitting a
 * sibling file; we inject it into a <style> at module
 * init so the icon glyph mapping and component styles
 * reach every shadow root without a separate network
 * round-trip and without ordering risk.
 *
 * One file, one URL, one cache entry.
 */
import appCss from './styles/app.css?inline'
import './components/transpareo-time-machine'

const style = document.createElement('style')
style.textContent = appCss
document.head.appendChild(style)
