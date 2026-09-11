// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What the hero image offers the browser. A snapshot that
 * names several renditions of an image gets a srcset and a
 * sizes hint describing the box the hero actually fills, so
 * a phone spends phone-sized bytes on it. One that names
 * none renders from `src` alone, and paging from a
 * many-rendition image to a single-rendition one clears the
 * list rather than leaving it to outrank the new src.
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as host from '@/host'
import type { DppSnapshot, SnapshotImage } from '@/types'
import '@/components/dpp-gallery'

const SIZES = '(max-width: 600px) calc(100vw - 50px), 320px'

function seed(images: ReadonlyArray<SnapshotImage>): void {
  const product = { name: { en: 'X' }, brand: 'B', images }
  host.currentVersion.set(1)
  host.snapshots.set({
    1: { version: 1, product } as unknown as DppSnapshot
  })
}

function mount(): HTMLImageElement {
  const el = document.createElement('dpp-gallery')
  document.body.appendChild(el)
  return el.querySelector('.gallery-image') as HTMLImageElement
}

function withWidths(
  name: string, widths: ReadonlyArray<number>
): SnapshotImage {
  const variants = widths.map((w) => ({
    url: `https://cdn.example.com/${name}-${w}.jpg`, width: w
  }))
  return {
    thumbnail: `https://cdn.example.com/${name}-800.jpg`,
    large: `https://cdn.example.com/${name}-1500.jpg`,
    ...(variants.length > 0 ? { variants } : {})
  }
}

// Unmount before clearing the state the mounted gallery
// reads, or its effect runs once more against an empty
// snapshot cache, which the state layer treats as a read
// before load and throws on.
afterEach(() => {
  document.body.replaceChildren()
  host.currentVersion.set(0)
  host.snapshots.set({})
})

describe('dpp-gallery renditions', () => {
  it('offers every rendition, narrowest first', () => {
    seed([withWidths('a', [400, 800, 1500])])
    const img = mount()
    expect(img.getAttribute('srcset')).toBe([
      'https://cdn.example.com/a-400.jpg 400w',
      'https://cdn.example.com/a-800.jpg 800w',
      'https://cdn.example.com/a-1500.jpg 1500w'
    ].join(', '))
  })

  it('states the box the hero fills, not the viewport', () => {
    seed([withWidths('a', [400, 800])])
    expect(mount().getAttribute('sizes')).toBe(SIZES)
  })

  it('renders from src alone when no renditions are named', () => {
    seed([withWidths('a', [])])
    const img = mount()
    expect(img.getAttribute('srcset')).toBeNull()
    expect(img.getAttribute('sizes')).toBeNull()
    expect(img.src).toBe('https://cdn.example.com/a-800.jpg')
  })

  it('clears a list left over from the previous image', () => {
    seed([withWidths('a', [400, 800])])
    const img = mount()
    expect(img.getAttribute('srcset')).not.toBeNull()

    seed([withWidths('b', [])])
    expect(img.getAttribute('srcset')).toBeNull()
    expect(img.getAttribute('sizes')).toBeNull()
    expect(img.src).toBe('https://cdn.example.com/b-800.jpg')
  })
})
