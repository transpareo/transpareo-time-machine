/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The icon map a fixture publishes. It holds the product
 * rows' icons and the library entries' property icons in
 * one table keyed by the row's `key`, so the component
 * drawer finds an icon the same way a passport row does.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { FixtureSchema } from '../scripts/seed/schema.ts'
import { buildIconMap } from '../scripts/seed/emit-artefacts.ts'

const fixtures = new URL('../fixtures/', import.meta.url)

function load(id: string): ReturnType<typeof FixtureSchema.parse> {
  const text = readFileSync(new URL(`${id}.yml`, fixtures), 'utf8')
  return FixtureSchema.parse(parse(text))
}

// Every property key across a fixture's library entries.
function libraryKeys(id: string): string[] {
  const root = new URL(`${id}/library/`, fixtures)
  const keys = new Set<string>()
  for (const slug of readdirSync(root, { withFileTypes: true })) {
    if (!slug.isDirectory()) continue
    const dir = new URL(`${slug.name}/`, root)
    for (const file of readdirSync(dir)) {
      const entry = JSON.parse(readFileSync(new URL(file, dir), 'utf8'))
      for (const p of entry.properties) keys.add(p.key)
    }
  }
  return [...keys].sort()
}

describe('the published icon map', () => {
  it.each(['nordic-wear-tshirt', 'volturra-pulse-2000'])(
    'names an icon for every library property of %s',
    (id) => {
      const map = buildIconMap(load(id))
      const missing = libraryKeys(id).filter((k) => !Object.hasOwn(map, k))
      expect(missing).toEqual([])
    }
  )

  it('refuses a library icon that contradicts a product row', () => {
    const fixture = load('nordic-wear-tshirt')
    const clash = { ...fixture, library_icons: { origin: 'leaf' } }
    expect(() => buildIconMap(clash)).toThrow(/'origin'/)
  })
})
