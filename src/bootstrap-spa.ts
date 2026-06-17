/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Deferred boot module reached via the lib entry
 * (`src/main.ts`). The lib build is the bundler
 * delivery shape: a consumer doing `npm install
 * transpareo-time-machine` integrates the renderer in
 * their own pipeline, and `import './styles/app.css'`
 * below leaves the stylesheet as a sibling asset
 * (`transpareo-time-machine.css`) their bundler can
 * fingerprint, reorder, and inline alongside their own
 * CSS.
 *
 * The script-tag delivery shape (`src/embed.ts` ->
 * `dist-embed/embed.js`) takes the opposite trade: it
 * inlines the stylesheet so a no-build embedder gets a
 * single URL. The two entries share every component
 * import below, they only differ in how app.css
 * reaches the page.
 *
 * Data loading happens inside <transpareo-time-machine>
 * when its `src` attribute connects to the host
 * module's fetch flow; the HTML shell loads its own
 * branding stylesheet (per-issuer <link> rendered by
 * the host) on top of whichever delivery shape was
 * chosen.
 */

// Global design tokens on :root. Cascade through every
// component's shadow DOM so colour/type/motion vars
// are available wherever they're referenced.
import './styles/app.css'

import './components/transpareo-time-machine'
import { startRevokedRootsCheck } from './revoked-roots'
import { armRevocationGuard } from './actions'
import { bootstrapShowTokens } from './show-filter'

// Arm the reactive revocation guard, then kick off the
// revoked-roots fetch. The fetch races with the manifest
// fetch; the guard re-derives any verdicts computed while
// the fetch was still in flight, so a 'revoked' result
// forces every snapshot to unauthenticated.
armRevocationGuard()
startRevokedRootsCheck()

// Arm the popstate listener for the `?show=` namespace
// gate. The signal already carries the initial value
// from module load; this picks up back/forward
// navigation (a host page mutating `?show=` via
// pushState calls refreshShowTokens() itself).
bootstrapShowTokens()
