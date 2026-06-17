/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Tagged-template DOM builder. Declares a component's
 * markup once as a static structure with reactive
 * expressions interpolated into text content, attributes,
 * boolean attributes, DOM properties, and event handlers.
 * Each interpolation that is a function is wired to the
 * host's effect scope, so updates touch only the bound
 * node/attr/property and dispose in lockstep with the
 * host element.
 *
 * When to use this vs. the imperative `el()` helper in
 * ./dom.ts:
 *
 *   `html` is the right tool when the structure is mostly
 *   static and carries several small reactive bindings.
 *   <dpp-hero> is the model case: one passport card with
 *   roughly a dozen reactive text/attribute slots. Each
 *   `${fn}` becomes one targeted update, with no
 *   per-binding `this.effect()` boilerplate at the call
 *   site.
 *
 *   The imperative `el()` builder is the right tool when
 *   the whole subtree gets rebuilt on each change
 *   (timeline rows, deck cards, modal bodies). Per-
 *   binding reactivity buys nothing if the parent effect
 *   throws the tree away and rebuilds it from scratch.
 *
 * Usage inside a BaseElement.setup():
 *
 *   const tpl = html`
 *     <button class=${() => active() ? 'on' : 'off'}
 *             @click=${onClick}>
 *       ${() => label()}
 *     </button>`
 *   tpl.mount(this.root, this.effect.bind(this))
 *
 * Binding kinds:
 *   ${value}     in text  -> text node, reactive if fn.
 *   ${value}     in attr  -> attribute, reactive if fn.
 *   class=${fn}           -> reactive className.
 *   @event=${fn}          -> addEventListener.
 *   ?attr=${fn}           -> boolean attribute toggle.
 *   .prop=${fn}           -> DOM property assignment.
 *
 * How it works: each interpolation is substituted with a
 * placeholder (BEL-byte delimited, so it cannot collide
 * with author markup), the assembled string is parsed via
 * <template>.innerHTML, then walk() visits every node and
 * swaps the placeholders for live text nodes / attribute
 * setters / property assignments / event listeners. The
 * `register` callback passed to mount() is the host's
 * effect() method, which ties each reactive binding to
 * the element's lifecycle.
 */
type Dynamic = unknown | (() => unknown)
type Effect = (fn: () => void | (() => void)) => void

// Written as backslash-u0007 escapes, not literal BEL
// bytes: the values are identical, but invisible control
// characters in source read as a bare 'TM:' in most
// viewers, which has already misled review into "the
// marker can collide with author markup". It cannot; a
// BEL byte cannot appear in a template literal by
// accident.
const MARKER_OPEN = '\u0007TM:'
const MARKER_CLOSE = '\u0007'

export interface TemplateResult {
  mount(host: ParentNode, register: Effect): void
}

export function html(
  strings: TemplateStringsArray,
  ...values: Dynamic[]
): TemplateResult {
  let raw = strings[0]
  for (let i = 0; i < values.length; i++) {
    raw += `${MARKER_OPEN}${i}${MARKER_CLOSE}` + strings[i + 1]
  }

  return {
    mount(host, register) {
      const tpl = document.createElement('template')
      tpl.innerHTML = raw
      const fragment = tpl.content
      walk(fragment, values, register)
      host.appendChild(fragment)
    },
  }
}

function walk(
  node: ParentNode | ChildNode,
  values: Dynamic[],
  register: Effect,
): void {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element
    // Attributes (snapshot first because we mutate).
    const attrs = Array.from(el.attributes)
    for (const attr of attrs) {
      const idx = parseMarker(attr.value)
      if (idx === null) continue
      const value = values[idx]
      bindAttribute(el, attr.name, value, register)
    }
  } else if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text
    const data = text.data
    if (!data.includes(MARKER_OPEN)) return
    const replacement = expandText(data, values, register)
    text.replaceWith(replacement)
    return
  }
  if ('childNodes' in node) {
    const kids = Array.from(node.childNodes)
    for (const k of kids) walk(k, values, register)
  }
}

function parseMarker(s: string): number | null {
  const m = s.match(
    new RegExp(`^${MARKER_OPEN}(\\d+)${MARKER_CLOSE}$`),
  )
  return m ? parseInt(m[1], 10) : null
}

function expandText(
  data: string,
  values: Dynamic[],
  register: Effect,
): DocumentFragment {
  const re = new RegExp(
    `${MARKER_OPEN}(\\d+)${MARKER_CLOSE}`, 'g',
  )
  const frag = document.createDocumentFragment()
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(data))) {
    if (m.index > last) {
      frag.appendChild(document.createTextNode(
        data.slice(last, m.index),
      ))
    }
    const value = values[parseInt(m[1], 10)]
    frag.appendChild(makeTextNode(value, register))
    last = m.index + m[0].length
  }
  if (last < data.length) {
    frag.appendChild(document.createTextNode(data.slice(last)))
  }
  return frag
}

function makeTextNode(value: Dynamic, register: Effect): Node {
  if (value instanceof Node) return value
  if (typeof value === 'function') {
    const node = document.createTextNode('')
    register(() => {
      // why: Dynamic is `unknown | (() => unknown)`, so
      // TS cannot narrow `value` to a function based on
      // the runtime `typeof` check alone. Re-asserting
      // here is safer than widening Dynamic to a union
      // that callers would have to disambiguate too.
      const v = (value as () => unknown)()
      node.textContent = v == null ? '' : String(v)
    })
    return node
  }
  return document.createTextNode(value == null ? '' : String(value))
}

function bindAttribute(
  el: Element,
  name: string,
  value: Dynamic,
  register: Effect,
): void {
  // Special prefixes: @event, ?bool-attr, .prop
  if (name.startsWith('@')) {
    el.removeAttribute(name)
    if (typeof value === 'function') {
      el.addEventListener(
        name.slice(1), value as EventListener,
      )
    }
    return
  }
  if (name.startsWith('?')) {
    const real = name.slice(1)
    el.removeAttribute(name)
    register(() => {
      // why: same narrowing limitation as makeTextNode -
      // the typeof check is for runtime dispatch; the
      // cast tells TS to trust it.
      const v = typeof value === 'function'
        ? (value as () => unknown)() : value
      if (v) el.setAttribute(real, '')
      else el.removeAttribute(real)
    })
    return
  }
  if (name.startsWith('.')) {
    const prop = name.slice(1)
    el.removeAttribute(name)
    register(() => {
      const v = typeof value === 'function'
        ? (value as () => unknown)() : value
      // why: writing an arbitrary property name to an
      // Element via TS's typed API requires either a
      // narrow union per known property (untenable; the
      // caller decides which prop) or a structural cast.
      // The `as unknown as Record<...>` chain silences TS
      // without inventing a property that doesn't exist
      // on Element. Safe because the caller controls the
      // property name and the template engine never
      // synthesises one.
      ;(el as unknown as Record<string, unknown>)[prop] = v
    })
    return
  }
  // Reactive plain attribute or className.
  el.removeAttribute(name)
  if (typeof value === 'function') {
    register(() => {
      // why: see makeTextNode; same Dynamic-narrowing
      // limitation.
      const v = (value as () => unknown)()
      if (v == null || v === false) el.removeAttribute(name)
      else el.setAttribute(name, String(v))
    })
  } else if (value != null && value !== false) {
    el.setAttribute(name, String(value))
  }
}
