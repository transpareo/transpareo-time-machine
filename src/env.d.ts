/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Ambient declarations for browser surfaces the TypeScript
 * DOM library does not carry yet. Internal to the build:
 * the package's published types live in /types, and nothing
 * here is part of the public API.
 *
 * `moduleDetection: force` makes every file a module, so
 * these have to be stated as a global augmentation rather
 * than as bare interfaces.
 */

export {}

declare global {
  // Network Information is available in Chromium and absent
  // in Firefox and Safari, so every reading is optional and
  // every caller has to work without it.
  interface NetworkInformation {
    readonly saveData?: boolean
    readonly effectiveType?: string
  }

  interface Navigator {
    readonly connection?: NetworkInformation
  }
}
