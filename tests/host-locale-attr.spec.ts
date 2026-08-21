// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * What an element's markup asks the renderer to render in.
 *
 * `locale` is the deliberate instruction and outranks `lang`,
 * which a shell may template into every element for assistive
 * tech and search engines rather than to steer this one. That
 * is what makes `locale="auto"` useful: it is how such a page
 * says "not that, ask the visitor's browser".
 */

import { describe, it, expect } from 'vitest'
import { hostLocaleOf } from '@/i18n'

function element(attrs: Record<string, string>, html = ''): Element {
  document.body.innerHTML = html || '<div id="host"></div>'
  const el = document.createElement('span')
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.querySelector('#host')!.appendChild(el)
  return el
}

describe('hostLocaleOf: a locale the markup names', () => {
  it('takes the locale attribute', () => {
    expect(hostLocaleOf(element({ locale: 'de' }))).toBe('de')
  })

  it('passes a regional tag through for setHostLocale to strip', () => {
    expect(hostLocaleOf(element({ locale: 'de-AT' }))).toBe('de-AT')
  })

  it('still reads lang where no locale is given', () => {
    expect(hostLocaleOf(element({ lang: 'fr' }))).toBe('fr')
  })

  it('lets locale outrank a lang on the same element', () => {
    expect(hostLocaleOf(element({ locale: 'de', lang: 'fr' }))).toBe('de')
  })

  it('ignores the whitespace a template leaves behind', () => {
    expect(hostLocaleOf(element({ locale: '  de  ' }))).toBe('de')
  })
})

describe('hostLocaleOf: detect', () => {
  it('answers nothing for an element that names no locale', () => {
    expect(hostLocaleOf(element({}))).toBeNull()
  })

  it('answers nothing for auto', () => {
    expect(hostLocaleOf(element({ locale: 'auto' }))).toBeNull()
  })

  it('lets auto overrule a templated lang', () => {
    // The case the keyword exists for: a shell that puts lang
    // on everything, and one widget that should follow the
    // visitor's browser instead.
    expect(hostLocaleOf(element({ locale: 'auto', lang: 'de' }))).toBeNull()
  })

  it('answers nothing for AUTO in any casing', () => {
    // Read as a language tag instead, a capitalised keyword
    // would be dropped as a locale no passport publishes, and
    // the page would detect without having been told to.
    expect(hostLocaleOf(element({ locale: 'AUTO' }))).toBeNull()
    expect(hostLocaleOf(element({ locale: 'Auto' }))).toBeNull()
  })

  it('treats an empty locale as absent', () => {
    // A template emitting an unset variable degrades to
    // detection rather than to a locale named "".
    expect(hostLocaleOf(element({ locale: '' }))).toBeNull()
    expect(hostLocaleOf(element({ locale: '   ' }))).toBeNull()
  })

  it('falls back to lang when the locale is empty', () => {
    expect(hostLocaleOf(element({ locale: '', lang: 'fr' }))).toBe('fr')
  })
})

describe('hostLocaleOf: inherit', () => {
  it('takes the language surrounding the element', () => {
    const el = element(
      { locale: 'inherit' },
      '<div lang="de"><section id="host"></section></div>',
    )
    expect(hostLocaleOf(el)).toBe('de')
  })

  it('takes the nearest one, not the outermost', () => {
    const el = element(
      { locale: 'inherit' },
      '<div lang="de"><div lang="fr"><p id="host"></p></div></div>',
    )
    expect(hostLocaleOf(el)).toBe('fr')
  })

  it('reads the document element too', () => {
    document.documentElement.setAttribute('lang', 'sv')
    try {
      expect(hostLocaleOf(element({ locale: 'inherit' }))).toBe('sv')
    } finally {
      document.documentElement.removeAttribute('lang')
    }
  })

  it('ignores a lang on the element itself', () => {
    // `inherit` asks what this sits inside of, the sense CSS
    // gives the word, so the element's own markup is not an
    // answer to it.
    const el = element(
      { locale: 'inherit', lang: 'fr' },
      '<div lang="de"><section id="host"></section></div>',
    )
    expect(hostLocaleOf(el)).toBe('de')
  })

  it('takes INHERIT in any casing', () => {
    const html = '<div lang="de"><section id="host"></section></div>'
    expect(hostLocaleOf(element({ locale: 'INHERIT' }, html))).toBe('de')
    expect(hostLocaleOf(element({ locale: 'Inherit' }, html))).toBe('de')
  })

  it('falls through to detect when nothing around it says', () => {
    expect(hostLocaleOf(element({ locale: 'inherit' }))).toBeNull()
  })
})

// The renderer declares the language it settled on, so a
// screen reader reads the passport with the right phonemes
// even where the document around it says otherwise. It
// declares it inside its own shadow tree, never on the
// element or the document, and this pins that boundary:
// hostLocaleOf falls through to `lang`, so a value written
// where it can see it would come back as if the page had
// instructed it.
describe('the language the renderer declares', () => {
  it('cannot read back a lang written inside the widget', () => {
    const el = element({})
    const shadowish = document.createElement('div')
    shadowish.className = 'tm-content'
    shadowish.lang = 'de'
    el.appendChild(shadowish)
    expect(hostLocaleOf(el)).toBeNull()
  })

  it('still reads a lang the page put on the element', () => {
    const el = element({ lang: 'fr' })
    const shadowish = document.createElement('div')
    shadowish.className = 'tm-content'
    shadowish.lang = 'de'
    el.appendChild(shadowish)
    expect(hostLocaleOf(el)).toBe('fr')
  })
})
