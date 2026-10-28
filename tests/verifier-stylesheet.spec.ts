/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The <dpp-verifier> stylesheet carries the widget's own rules
 * and the icon rules, and none of the passport page's: the page
 * ships those in its own stylesheet, and the bundle would
 * otherwise carry them twice.
 */
import { describe, it, expect } from 'vitest'
import { compile } from 'sass'
import { fileURLToPath } from 'node:url'

const STYLES = fileURLToPath(new URL('../src/styles/', import.meta.url))

function css(name: string): string {
  return compile(`${STYLES}${name}.scss`, { loadPaths: [STYLES] }).css
}

describe('dpp-verifier.scss', () => {
  const verifier = css('dpp-verifier')

  it('ships none of the passport page rules', () => {
    expect(verifier).not.toMatch(/\.dpp-[a-z-]+[^{]*\{/)
    expect(verifier).not.toContain('#app .content')
  })

  it('keeps the icon sizing its orbs draw with', () => {
    expect(verifier).toContain('svg.icon')
  })
})

describe('transpareo-time-machine.scss', () => {
  it('opens with the page rules, ahead of the components', () => {
    const page = css('transpareo-time-machine')
    const hero = page.indexOf('.dpp-hero {')
    const modal = page.indexOf('.modal')
    expect(hero).toBeGreaterThan(-1)
    expect(hero).toBeLessThan(modal)
    expect(page).toContain('svg.icon')
  })
})
