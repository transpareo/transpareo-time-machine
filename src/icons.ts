/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * SVG icon plumbing, split into two tiers so the SPA's own
 * controls never depend on an externally hosted sprite.
 *
 * Functional icons (close, expand, status, spinner, etc.)
 * ship inline as a small bundled sprite, injected into the
 * host shadow root on boot. They always render, even with
 * no content sprite configured (an OSS fork ships none).
 *
 * Decorative / content icons are the publisher's icon
 * vocabulary. A property row carries no icon; its symbol
 * is resolved from the row's `key` through the external
 * icon map (`iconForProperty`, below), so any of the full
 * sprite's symbols may be used. The host supplies that
 * sprite via the element's `icons-src` attribute and the
 * key->symbol table via `icon-map-src`; in dev they
 * default to the seeded /icons.svg and per-publisher
 * /<id>/icon-map.json. The sprite is fetched and
 * injected into the same shadow root, so bare `#id` refs
 * resolve same-origin and the cross-origin `<use>`
 * restriction never applies. When a content sprite is
 * configured the host gains a `data-icons` attribute, and
 * the stylesheet reserves space for content icons only
 * then, so a no-sprite fork shows no empty icon boxes.
 *
 * Every `<use>` reference is a bare `#id`; both sprites are
 * injected into the same root.
 */

import { config } from '@/config'
import { SVG_NS } from '@/reactive/dom'
import { signal } from '@/reactive/signals'

// Symbol ids that don't follow the `icon-` family pattern,
// passed through verbatim by `icon()`.
const SPRITE_ALIASES = new Set(['chevron-down', 'spinner'])

// Functional icon ids: the SPA's own controls and status
// glyphs. Inlined in FUNCTIONAL_SPRITE below and flagged
// with `icon--fn` so the stylesheet never collapses them.
const FUNCTIONAL_IDS = new Set([
  'icon-cancel', 'icon-ok', 'spinner', 'chevron-down',
  'icon-down', 'icon-history', 'icon-resize-full',
  'icon-download', 'icon-link-ext', 'icon-arrow',
  'icon-key', 'icon-info',
])

// The functional symbols, lifted verbatim from the full
// sprite (public/icons.svg) so the controls keep their
// exact glyphs. Bundled here, not fetched, so they survive
// without a content sprite. Several glyphs are converted
// icon-font artwork (Font Awesome, Entypo, Iconic,
// Elusive); see THIRD-PARTY-LICENSES.md for the per-set
// attribution this file ships under.
const FUNCTIONAL_SPRITE =
  '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">' +
  '<symbol id="icon-cancel" viewBox="0 0 785 1000"><path transform="translate(0 850) scale(1 -1)" d="M724 112q0-22-15-38l-76-76q-16-15-38-15t-38 15l-164 165-164-165q-16-15-38-15t-38 15l-76 76q-16 16-16 38t16 38l164 164-164 164q-16 16-16 38t16 38l76 76q16 16 38 16t38-16l164-164 164 164q16 16 38 16t38-16l76-76q15-15 15-38t-15-38l-164-164 164-164q15-15 15-38z"/></symbol>' +
  '<symbol id="icon-ok" viewBox="0 0 928 1000"><path transform="translate(0 850) scale(1 -1)" d="M352-10l-334 333 158 160 176-174 400 401 159-160z"/></symbol>' +
  '<symbol id="spinner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="14 42"/></symbol>' +
  '<symbol id="chevron-down" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 9 L12 15 L18 9"/></symbol>' +
  '<symbol id="icon-down" viewBox="0 0 1702 1000"><path transform="translate(0 850) scale(1 -1)" d="M47 799c63 65 153 71 231 0l573-551 574 551c78 71 167 65 231 0 64-66 60-176 0-238-60-61-689-662-689-662-32-33-74-49-116-49s-83 16-116 49c0 0-629 601-688 662-60 62-65 172 0 238z"/></symbol>' +
  '<symbol id="icon-history" viewBox="0 0 940 1000"><path transform="translate(0 850) scale(1 -1)" d="M532 760q170 0 289-120t119-290-119-290-289-120q-138 0-252 88l70 76q82-60 182-60 126 0 216 90t90 216q0 128-90 218t-216 90q-124 0-213-86t-93-210l142 0-184-206-184 206 124 0q4 166 123 282t285 116z m-36-190l70 0 0-204 130-130-50-50-150 150 0 234z"/></symbol>' +
  '<symbol id="icon-resize-full" viewBox="0 0 792 1000"><path transform="translate(0 850) scale(1 -1)" d="M476 746l316 0 0-316-100 124-146-152-100 100 152 146z m-230-444l100-100-152-146 122-100-316 0 0 316 100-122z"/></symbol>' +
  '<symbol id="icon-download" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 4 L12 15 M7 10 L12 15 L17 10 M5 19 L19 19"/></symbol>' +
  '<symbol id="icon-link-ext" viewBox="0 0 1000 1000"><path transform="translate(0 850) scale(1 -1)" d="M786 332v-178q0-67-47-114t-114-47h-464q-67 0-114 47t-47 114v464q0 66 47 113t114 48h393q7 0 12-5t5-13v-36q0-8-5-13t-12-5h-393q-37 0-63-26t-27-63v-464q0-37 27-63t63-27h464q37 0 63 27t26 63v178q0 8 5 13t13 5h36q8 0 13-5t5-13z m214 482v-285q0-15-11-25t-25-11-25 11l-98 98-364-364q-5-6-13-6t-12 6l-64 64q-6 5-6 12t6 13l364 364-98 98q-11 11-11 25t11 25 25 11h285q15 0 25-11t11-25z"/></symbol>' +
  '<symbol id="icon-arrow" viewBox="0 0 1000 1000"><path transform="translate(0 850) scale(1 -1)" d="M0 170l0 360 414 0 0 211 586-391-586-391 0 211-414 0z"/></symbol>' +
  '<symbol id="icon-key" viewBox="0 0 780 1000"><path transform="translate(0 850) scale(1 -1)" d="M774 612q20-116-28-215t-150-117q-66-12-130-2l-118-194-70-12-104-166q-14-28-46-32l-76-14q-12-4-22 4t-12 22l-16 98q-8 30 12 56l258 386q-24 50-38 120-18 106 53 187t185 101q106 20 195-45t107-177z m-126-76q30 44 21 97t-51 83q-42 32-92 22t-80-54q-8-12-12-23t-1-20 5-16 13-17 18-15 22-16 23-17q6-4 22-16t23-16 19-12 19-8 17 1 18 8 16 19z"/></symbol>' +
  '<symbol id="icon-info" viewBox="0 0 460 1000"><path transform="translate(0 850) scale(1 -1)" d="M352 850q48 0 74-27t26-69q0-50-39-88t-95-38q-48 0-74 26t-24 72q0 46 35 85t97 39z m-206-1000q-100 0-54 178l60 254q14 56 0 56-12 0-54-18t-72-38l-26 44q90 78 189 126t151 48q78 0 36-162l-70-266q-16-64 6-64 44 0 118 60l30-40q-84-86-175-132t-139-46z"/></symbol>' +
  '</svg>'

function resolveId(name: string): string {
  return SPRITE_ALIASES.has(name) ? name : `icon-${name}`
}

// `name` is the bare symbol id without the `icon-` prefix
// for the icon-family entries, or the full id for utility
// symbols (`chevron-down`, `spinner`):
//   icon('leaf')         -> <use href="#icon-leaf">
//   icon('chevron-down') -> <use href="#chevron-down">
// Functional names also get the `icon--fn` class so the
// stylesheet keeps them visible without a content sprite.
export function icon(name: string): SVGSVGElement {
  const id = resolveId(name)
  const svg = document.createElementNS(SVG_NS, 'svg')
  const fn = FUNCTIONAL_IDS.has(id) ? ' icon--fn' : ''
  svg.setAttribute('class', `icon icon-${name}${fn}`)
  svg.setAttribute('aria-hidden', 'true')
  const use = document.createElementNS(SVG_NS, 'use')
  use.setAttribute('href', `#${id}`)
  svg.appendChild(use)
  return svg
}

// The external content-sprite URL: the host override, or
// the seeded dev sprite. Null in a production build with no
// override, so a fork ships no Transpareo content icons and
// the stylesheet collapses the decorative icon boxes.
export function contentSpriteUrl(): string | null {
  if (config.iconsUrl) return config.iconsUrl
  return import.meta.env.DEV ? '/icons.svg' : null
}

// Property-key -> content-sprite symbol id, supplied
// externally like the sprite itself so this repo ships no
// type-to-icon vocabulary. Snapshot rows carry no icon; the
// renderer looks each row up by its `key` (the wire
// `propertyID` / namespace). Held in a signal so rows that
// render before the fetch resolves pick the icon up on the
// next reactive pass. Empty until loadContentIconMap runs.
const contentIconMap = signal<Readonly<Record<string, string>>>({})

// The content-sprite symbol id for a property key, or null
// when the external map has no entry (or hasn't loaded
// yet). Reading the signal subscribes the calling effect,
// so a row rendered before the map arrives re-renders with
// its icon once it does.
export function iconForProperty(key: string): string | null {
  return contentIconMap()[key] ?? null
}

// The external icon-map URL from the host's `icon-map-src`,
// or null when unset, mirroring contentSpriteUrl: a fork
// ships no map and rows stay iconless.
export function iconMapUrl(): string | null {
  return config.iconMapUrl ?? null
}

// Fetch the external key-to-icon table and publish it to
// the signal. Best-effort like the sprite: a missing or
// malformed map leaves rows iconless and never blocks boot.
export function loadContentIconMap(): void {
  const url = iconMapUrl()
  if (!url) return
  void fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
    .then((data: unknown) => contentIconMap.set(sanitizeIconMap(data)))
    .catch(() => { /* map unreachable or invalid: rows stay iconless */ })
}

// Keep only string->string entries whose value is a bare
// symbol id, so a tampered map can't smuggle anything but a
// plain `#id` into a `<use href>`. Keys are lookup-only and
// never reach the DOM, so they pass through unconstrained.
function sanitizeIconMap(data: unknown): Record<string, string> {
  if (typeof data !== 'object' || data === null) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string' && /^[a-z0-9-]+$/.test(v)) out[k] = v
  }
  return out
}

// Injects the bundled functional sprite into the shadow
// root (always), and the configured content sprite (when
// one is set), so bare `#id` <use> refs resolve same-origin
// within the root. Marks the host with `data-icons` when a
// content sprite is configured so the stylesheet reserves
// space for decorative icons only then. Fetch failure or a
// non-SVG content-type is swallowed: the (configured)
// decorative boxes stay empty, the functional controls are
// unaffected.
export function installIcons(root: ShadowRoot, host: Element): void {
  injectSprite(root, FUNCTIONAL_SPRITE)
  loadContentIconMap()
  const url = contentSpriteUrl()
  if (!url) return
  host.setAttribute('data-icons', '')
  void fetch(url)
    .then((r) => {
      if (!r.ok) return Promise.reject(new Error(`${r.status}`))
      const type = r.headers.get('content-type') ?? ''
      if (!type.startsWith('image/svg')) {
        return Promise.reject(new Error(`not an SVG sprite: ${type}`))
      }
      return r.text()
    })
    .then((markup) => injectContentSprite(root, markup))
    .catch(() => { /* sprite unreachable or not SVG: decorative icons stay empty */ })
}

// The bundled functional sprite is part of this source file,
// so it is trusted markup and injected wholesale.
function injectSprite(root: ShadowRoot, markup: string): void {
  const tpl = document.createElement('template')
  tpl.innerHTML = markup.trim()
  const svg = tpl.content.querySelector('svg')
  if (!svg) return
  svg.setAttribute('aria-hidden', 'true')
  svg.style.display = 'none'
  root.appendChild(svg)
}

// The content sprite arrives from a publisher-configured URL
// (typically a CDN), so its markup is untrusted: a
// compromised sprite host must not get script or styling
// into the shadow root, where it could repaint the
// verification chip. Only <symbol> nodes are taken from the
// fetched document, each scrubbed by scrubSymbol. Markup
// that doesn't parse as SVG injects nothing.
function injectContentSprite(root: ShadowRoot, markup: string): void {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  if (doc.querySelector('parsererror')) return
  const symbols = Array.from(doc.querySelectorAll('symbol'))
    .filter((symbol) => scrubSymbol(symbol))
  if (symbols.length === 0) return
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.display = 'none'
  for (const symbol of symbols) {
    svg.appendChild(document.importNode(symbol, true))
  }
  root.appendChild(svg)
}

const FORBIDDEN_ELEMENTS = new Set(['script', 'style', 'foreignObject'])
const SMIL_ELEMENTS = new Set([
  'animate', 'animateMotion', 'animateTransform', 'set',
])

// Drops every element that could execute, embed, or restyle
// (non-SVG-namespace nodes cover smuggled HTML like iframe
// or embed; an injected <style> would restyle the whole
// shadow root even from inside a never-rendered symbol),
// every `on*` event-handler attribute, and every href that
// isn't a same-document fragment ref. SMIL elements that
// retarget an href are dropped too, so an animation can't
// reintroduce a URL the static scrub removed. Returns false
// when the symbol element itself is forbidden (a smuggled
// non-SVG node), telling the caller to skip it entirely.
function scrubSymbol(symbol: Element): boolean {
  if (isForbiddenElement(symbol)) return false
  const doomed: Element[] = []
  for (const node of [symbol, ...symbol.querySelectorAll('*')]) {
    if (node !== symbol && isForbiddenElement(node)) {
      doomed.push(node)
      continue
    }
    for (const attr of Array.from(node.attributes)) {
      if (isForbiddenAttribute(attr)) node.removeAttributeNode(attr)
    }
  }
  for (const node of doomed) node.remove()
  return true
}

function isForbiddenElement(node: Element): boolean {
  if (node.namespaceURI !== SVG_NS) return true
  if (FORBIDDEN_ELEMENTS.has(node.localName)) return true
  return SMIL_ELEMENTS.has(node.localName)
    && /href/i.test(node.getAttribute('attributeName') ?? '')
}

function isForbiddenAttribute(attr: Attr): boolean {
  const name = attr.localName.toLowerCase()
  if (name.startsWith('on')) return true
  return name === 'href' && !attr.value.trimStart().startsWith('#')
}
