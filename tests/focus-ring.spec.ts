/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * No stylesheet takes the focus ring away from a keyboard
 * user. A hover tint shared with :focus-visible is fine as
 * long as the ring stays; the one place a rule may drop the
 * outline is `:focus:not(:focus-visible)`, the mouse click
 * the browser would otherwise ring. The browser suite walks
 * the controls the demo reaches; this covers the ones it
 * cannot, such as the sign-in and retry buttons.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const STYLES = fileURLToPath(new URL('../src/styles/', import.meta.url))

function suppressions(): string[] {
  return readdirSync(STYLES)
    .filter((name) => name.endsWith('.scss'))
    .flatMap((name) => readFileSync(STYLES + name, 'utf8')
      .split('\n')
      .map((line, i) => ({ line, at: `${name}:${i + 1}` })))
    .filter(({ line }) => /outline:\s*(none|0)\b/.test(line))
    .filter(({ line }) => !line.includes(':not(:focus-visible)'))
    .map(({ at }) => at)
}

describe('focus ring', () => {
  it('is only dropped for a focus the mouse made', () => {
    expect(suppressions()).toEqual([])
  })
})
