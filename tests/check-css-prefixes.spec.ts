/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The prefix gate on the built bundle: a rule that ships a
 * vendor-prefixed declaration without its standard form
 * fails, because the browsers that dropped the prefix then
 * see nothing.
 */
import { describe, it, expect } from 'vitest'
import {
  pairedProperties,
  unpairedRules
} from '../scripts/check-css-prefixes.ts'

describe('pairedProperties', () => {
  it('collects standard names the source also writes prefixed', () => {
    const scss = `
      .a {
        -webkit-mask-image: var(--x);
        mask-image: var(--x);
        -webkit-overflow-scrolling: touch;
        &:hover { color: red; }
      }
    `
    const props = pairedProperties([scss])

    expect(props.has('mask-image')).toBe(true)
    expect(props.has('overflow-scrolling')).toBe(false)
    expect(props.has('color')).toBe(false)
  })

  it('always checks backdrop-filter', () => {
    expect(pairedProperties([]).has('backdrop-filter')).toBe(true)
  })
})

describe('unpairedRules', () => {
  const props = new Set(['backdrop-filter', 'mask-image'])

  it('flags a rule that kept only the prefixed form', () => {
    const css = '.brandbar.stuck{background:red;'
      + '-webkit-backdrop-filter:blur(8px);border-bottom-color:red}'

    expect(unpairedRules(css, props)).toEqual(['.brandbar.stuck'])
  })

  it('passes a rule that kept both forms', () => {
    const css = '.overlay{-webkit-backdrop-filter:blur(6px);'
      + 'backdrop-filter:blur(6px)}'

    expect(unpairedRules(css, props)).toEqual([])
  })

  it('judges each rule on its own', () => {
    const css = '.ok{-webkit-backdrop-filter:none;backdrop-filter:none}'
      + '.bad{-webkit-backdrop-filter:blur(8px)}'

    expect(unpairedRules(css, props)).toEqual(['.bad'])
  })

  it('tolerates a repeated prefixed declaration', () => {
    const css = '.logo{-webkit-mask-image:var(--u);'
      + '-webkit-mask-image:var(--u);mask-image:var(--u)}'

    expect(unpairedRules(css, props)).toEqual([])
  })

  it('reads rules nested in at-rules and spread over lines', () => {
    const css = '@media (max-width:480px){\n  .card {\n'
      + '    -moz-backdrop-filter: blur(2px);\n  }\n}'

    expect(unpairedRules(css, props)).toEqual(['.card'])
  })

  it('ignores properties outside the checked set', () => {
    const css = '.clamp{-webkit-line-clamp:2;-webkit-box-orient:vertical}'

    expect(unpairedRules(css, props)).toEqual([])
  })
})
