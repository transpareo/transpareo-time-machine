/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Entry point. The host page loads this script in its
 * <head>; it registers the <transpareo-time-machine>
 * custom element and the rest of the renderer. The
 * HTML shell carries one <transpareo-time-machine
 * src="..."> tag, which fetches its manifest on connect
 * and renders into its shadow root. The renderer shows
 * one passport per page: a second element stays empty
 * and logs why (components/transpareo-time-machine.ts).
 */

import './bootstrap-spa'
