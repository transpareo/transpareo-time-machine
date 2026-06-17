/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Boundary-error helpers. The SPA's fetch + crypto +
 * auth layers all need to convert an unknown caught
 * value into a human-readable string for the console
 * (warning prefix) or for the verification modal's
 * per-entry `reason` line. Centralising the conversion
 * keeps the prefix shape consistent across modules and
 * avoids the four-line `instanceof Error ? .message :
 * String(err)` dance recurring across the codebase.
 */

// Coerce any caught value into a short, human-readable
// string. `Error.message` for Error subclasses; the
// default String() coercion for everything else (which
// covers thrown strings, numbers, plain objects with
// useful toString, etc.).
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
