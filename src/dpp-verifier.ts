/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Standalone verifier widget entry. Registers the
 * <dpp-verifier> custom element. A host page loads
 * this script (no companion <transpareo-time-machine>
 * needed) to drop a verification form anywhere on
 * the page:
 *
 *   <dpp-verifier></dpp-verifier>
 *   <script type="module" src=".../dpp-verifier.js"></script>
 *
 * The widget shares src/crypto/ with the full SPA, so
 * the math is identical to what the verification chip
 * does on a passport page; only the framing (form +
 * card) differs.
 */

import './components/dpp-verifier'
