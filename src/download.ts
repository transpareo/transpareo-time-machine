/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Tiny "save this object as a JSON file" helper. The
 * verification modal uses it to surface the signed
 * snapshot bytes per version (so a user or auditor can
 * re-verify offline against the manifest's hashValue);
 * the event modal uses it to surface the EPCIS event
 * payload. Both shapes are already in memory by the
 * time the user clicks, so we just serialise + trigger
 * a download via a temporary anchor element.
 *
 * No third-party "file-saver" library: the Blob URL +
 * temp anchor + revoke dance is six lines and works in
 * every browser the SPA otherwise targets (Chrome 113+,
 * Safari 17+, Firefox 129+).
 */

// Slugify into a filesystem-safe filename slice: lower-
// cased ASCII letters/digits/hyphens; everything else
// collapses to a single hyphen. Leading/trailing
// hyphens are trimmed so the output never starts with a
// dot or whitespace.
export function slugForFilename(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'download'
}

// Serialise `value` to indented JSON, wrap in a Blob,
// and trigger a download with the given filename. The
// .json extension is appended if the caller didn't
// include one.
export function downloadJson(
  value: unknown, filename: string,
): void {
  const name = /\.json$/i.test(filename) ? filename : `${filename}.json`
  const text = JSON.stringify(value, null, 2)
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name

  // Anchors must be in the document for `click()` to
  // work in Firefox; we attach, fire, detach, revoke.
  document.body.appendChild(a)
  a.click()
  a.remove()

  // Defer revoke until after the click has been
  // processed; immediate revoke races the navigation in
  // some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
