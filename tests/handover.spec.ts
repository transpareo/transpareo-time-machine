// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The travel from a host page's first frame into the card.
 * The renderer measures both layouts rather than asking the
 * host to match its own, so these cover the two readings it
 * takes: which picture on the host page is the one
 * travelling, and the transform that puts the card's picture
 * back where the host's was.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { travellerRect, invert } from '@/handover'

function rect(x: number, y: number, w: number): DOMRect {
  return { left: x, top: y, width: w, height: w } as DOMRect
}

function img(width: number, host: HTMLElement): HTMLImageElement {
  const el = document.createElement('img')
  el.getBoundingClientRect = () => rect(0, 0, width)
  host.appendChild(el)
  return el
}

afterEach(() => document.body.replaceChildren())

describe('travellerRect', () => {
  it('takes the largest picture the host is showing', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    img(120, host)
    img(340, host)
    img(80, host)
    expect(travellerRect(host)?.width).toBe(340)
  })

  it('passes over a logo-sized image', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    img(28, host)
    expect(travellerRect(host)).toBeNull()
  })

  it('is null for a host page showing no picture', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    expect(travellerRect(host)).toBeNull()
  })
})

describe('invert', () => {
  it('carries the corner delta and the scale', () => {
    const t = invert(rect(25, 64, 348), rect(306, 139, 320))
    expect(t).toBe('translate(-281px, -75px) scale(1.088)')
  })

  it('states a move with no resize', () => {
    expect(invert(rect(10, 10, 320), rect(60, 90, 320)))
      .toBe('translate(-50px, -80px) scale(1)')
  })

  it('declines a travel too small to read as motion', () => {
    expect(invert(rect(100, 100, 320), rect(100.4, 100.2, 320.5)))
      .toBeNull()
  })

  it('declines when the card has not been laid out yet', () => {
    expect(invert(rect(0, 0, 320), rect(0, 0, 0))).toBeNull()
  })
})
