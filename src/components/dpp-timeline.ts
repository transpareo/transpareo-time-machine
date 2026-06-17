/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Re-export shim for the timeline component. The
 * implementation moved to ./timeline/ to keep the file
 * sizes manageable; this file stays so external import
 * paths (`import './dpp-timeline'`) keep working.
 */

import './timeline/index'
