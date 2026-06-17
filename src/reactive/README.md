# `src/reactive/`

The renderer's vendored reactive runtime. Tiny on
purpose: about 750 lines of TypeScript, no external
runtime dependencies, no proxies, no virtual DOM. Every
component in `src/components/` builds on this surface.

This file is the contributor's reference. The whole
runtime is exercised by `tests/signals.spec.ts`, so the
behaviour described here is the behaviour the tests
pin down.

## Modules at a glance

| File | Purpose |
|------|---------|
| `signals.ts` | The three reactive primitives: `signal`, `computed`, `effect`. Plus `untrack`. |
| `element.ts` | `BaseElement` and `LightElement` custom-element bases. Lifecycle, effect scoping, optional shadow root. |
| `html.ts` | Tagged-template DOM builder. Use when structure is mostly static and reactivity is per-binding. |
| `dom.ts` | Imperative `el(tag, className?, text?)` helper plus the `SVG_NS` constant. Use when the whole subtree gets rebuilt on each change. |
| `modal.ts` | Shared chrome for modal overlays (Escape, body scroll lock, click-outside, dialog frame). |
| `tween.ts` | Eased animation primitives. |

## The signal contract

```ts
const count = signal(0)        // Signal<number>
count()                        // read; subscribes the active tracker
count.set(1)                   // write; notifies subscribers if changed
count.update(n => n + 1)       // sugar for set(fn(peek()))
count.peek()                   // read without subscribing
```

Three rules to internalize:

1. **Reads inside a tracked function subscribe.** A
   tracked function is anything passed to `effect()` or
   `computed(fn)`. Outside those scopes, reads are
   "free".
2. **`set()` short-circuits on `Object.is` equality.**
   `count.set(7)` after another `count.set(7)` does
   nothing. This is the cheap-but-good change-detection
   strategy; pass new object identities (`{ ...prev }`)
   when you want deep updates to propagate.
3. **`peek()` never subscribes.** Reach for it when you
   need the current value from inside a tracked
   function but do not want a dependency edge.

### Computed

```ts
const doubled = computed(() => count() * 2)
doubled()                      // 0 on first read; runs fn, caches
count.set(3)
doubled()                      // 6; fn re-ran lazily on this read
```

`computed` is lazy: it does not run its function until
the first read, and it only re-runs when one of the
signals it depends on changes. Reads do not pay
re-computation cost when nothing upstream moved.

Computed of computed propagates: invalidating any leaf
signal cascades up the chain on the next read.

### Effect

```ts
const dispose = effect(() => {
  console.log('count is', count())
})
count.set(1)                   // re-runs the effect
dispose()                      // halts further re-runs
```

Two behaviours worth knowing:

- **Cleanup**: the function returned from an effect's
  body runs before the next iteration AND on disposal.
  Use it to detach listeners, cancel timers, etc.
- **Disposal**: the returned `dispose` is idempotent
  and stops re-runs immediately. `BaseElement` and
  `LightElement` collect disposers automatically and
  run them in `disconnectedCallback`.

### `untrack`

```ts
effect(() => {
  const c = count()                  // subscribes
  const s = untrack(() => stamp())   // does NOT subscribe
  log(`${c} at ${s}`)
})
```

Use when you need the *current* value of another signal
but do not want the effect to re-run when that other
signal changes.

## Writing a custom element

Pick the base. **Use `LightElement`** for an inner
component (rendered into light DOM, inheriting the
outer element's bundled styles). **Use `BaseElement`**
when the element is the public surface and needs a
shadow root for style isolation.

```ts
import { LightElement } from '@/reactive/element'
import { html } from '@/reactive/html'
import { renderedProduct } from '@/state'

class DppHero extends LightElement {
  protected setup(): void {
    const tpl = html`
      <div class="dpp-hero">
        <h1>${() => renderedProduct().name}</h1>
      </div>`
    tpl.mount(this, this.effect.bind(this))
  }
}
customElements.define('dpp-hero', DppHero)
```

The `setup()` hook runs once on first
`connectedCallback`. Subscriptions registered via
`this.effect(...)` are auto-disposed in
`disconnectedCallback`.

## `html` vs `el` decision rule

Reach for `html` when **structure is mostly static and
the work is in the bindings**:

```ts
const tpl = html`
  <button class=${() => active() ? 'on' : 'off'}
          @click=${onClick}>
    ${() => label()}
  </button>`
```

Each `${fn}` becomes one targeted update on one node /
attribute / property / listener. The tree itself is
parsed once.

Reach for `el` when **the whole subtree is rebuilt on
each change**:

```ts
this.effect(() => {
  this.replaceChildren()
  for (const ev of sortedEvents()) {
    const row = el('div', 'event-row')
    row.appendChild(el('span', 'date', ev.occurredAt))
    row.appendChild(el('span', 'label', ev.label))
    this.appendChild(row)
  }
})
```

Per-binding reactivity buys nothing if the parent
effect throws the tree away anyway. The imperative
builder keeps the per-row code shallow.

Components like `<dpp-timeline>` (rows reshape with the
focused range) and `<dpp-deck>` (cards rebuild on
focus change) use `el`. `<dpp-hero>`, `<dpp-brandbar>`,
`<dpp-footer>` use `html`.

## `html` binding kinds

```ts
html`
  ${value}                 // text interpolation; reactive if value is a fn
  attr=${value}            // attribute; reactive if value is a fn
  class=${fn}              // shortcut for className; same rules
  @event=${handler}        // addEventListener(event, handler)
  ?attr=${fn}              // boolean attribute toggle (presence/absence)
  .prop=${fn}              // direct DOM property assignment
`
```

For text and attribute interpolations, a function value
is wired to the host's effect scope so updates touch
only that one node or attribute. A non-function value
becomes a static text node or attribute set once at
mount.

`@event` does NOT subscribe; pass an event handler
directly. `?attr` and `.prop` always go through an
effect because their input is always a function.

## Modal helpers

`bindModalChrome(host, effect, { isOpen, onClose })`
wires Escape, body-scroll-lock, and overlay
click-outside (with mousedown-origin tracking) for any
component that renders an overlay.

`buildModal({ title, body, accent?, titleId?,
onClose })` returns the standard dialog frame
(`.modal > .modal-header + .modal-body`) so every
modal in the SPA shares the same chrome and CSS
conventions.

## Tests

`tests/signals.spec.ts` covers signal read/write/peek/
update, `Object.is` change detection, multi-dependency
tracking, cleanup ordering, disposal idempotence,
computed laziness + memoization + propagation, and
`untrack`. Touching this directory means running
`npm test` before pushing.
