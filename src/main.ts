/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Entry point. The host page loads this script in its
 * <head>; it registers the <transpareo-time-machine>
 * custom element and the rest of the renderer. The
 * HTML shell carries one or more <transpareo-time-
 * machine src="..."> tags; each element fetches its
 * own manifest on connect and renders into its shadow
 * root.
 */

import './bootstrap-spa'
