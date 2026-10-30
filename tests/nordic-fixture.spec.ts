/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The Nordic Wear demo is where token chips show: its care
 * instructions are short enough in every language it
 * carries to flow inline. A garment size is a product with
 * a passport of its own, so no list names sizes.
 */

import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { FixtureSchema } from '../scripts/seed/schema.ts'
import { toWireLocalized } from '../scripts/seed/emit-artefacts.ts'
import { classifyWireValue } from '../src/property-classify'

const path = new URL('../fixtures/nordic-wear-tshirt.yml', import.meta.url)
const fixture = FixtureSchema.parse(parse(readFileSync(path, 'utf8')))
const lists = fixture.product.lists

describe('the Nordic Wear demo lists', () => {
  it('show the care instructions as chips', () => {
    const care = lists.find((l) => l.key === 'care')
    const kind = classifyWireValue(toWireLocalized(care?.values), undefined)

    expect(kind).toHaveProperty('compact', true)
  })

  it('name no sizes', () => {
    expect(lists.map((l) => l.key)).not.toContain('sizes')
  })
})
