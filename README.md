# Transpareo Time Machine

Open-source Digital Product Passport renderer.

The Transpareo Time Machine is a single-page app (SPA)
you embed as one custom element. Point it at a Digital
Product Passport and it renders an interactive card:
the product's current details up front, and a timeline
the visitor can scrub back through to replay every
earlier version the passport has had. A verification
chip on the card shows whether the data is authentic,
checked cryptographically in the visitor's own browser
instead of taken on trust from a server.

**Demo:**
[time-machine.transpareo.com](https://time-machine.transpareo.com)
renders two sample passports end to end, a Nordic Wear
t-shirt and a Volturra Pulse 2000, so you can scrub the
timeline and watch the verification chip in action.

Embedding it is one custom-element tag, pointed at a
passport manifest:

```html
<transpareo-time-machine
  src="https://example.com/dpp/abc-123/manifest.json">
</transpareo-time-machine>
```

The `src` is a manifest that lists every version, and
it can live anywhere you can serve a URL. The renderer
assumes nothing about where or how you host: it reads
each artefact's address from the manifest, so you
publish wherever you like.

License: [GPL-3.0-or-later](LICENSE).

## Why this exists

Most DPP renderers in 2026 either (a) trust an
issuer-controlled server's "verified" flag and re-render
it as a static UI, or (b) verify against a single
authority and surrender the result to the issuer's
infrastructure to display. The Transpareo Time Machine
instead:

- Computes the verification verdict **client-side**,
  in the visitor's browser, from the signed snapshot's
  embedded `eddsa-jcs-sha256` proof set, never from a
  server's "verified" flag. How much that verdict is
  worth depends on the surface it runs on. On a renderer
  the visitor trusts (e.g. the standalone verifier page)
  with a platform key pinned via `pinned-platform-key` /
  `config.pinnedPlatformKeys`, a compromised *data* origin
  cannot forge it. On a page the issuer fully controls,
  the chip is advisory: that page could paint its own
  badge or skip the renderer entirely, so the embedded
  chip is a convenience there, not a guarantee.
- Treats the issuer and the platform as **two
  independent authorities**. The default
  "any-issuer-and-any-platform" verdict groups proof
  entries by signature and requires one verified entry
  per group; it does not, on its own, bind the platform
  side to a particular key. Pin a platform key to bind
  it, or use strict all-entries mode for high-trust
  surfaces.
- Ships **zero runtime dependencies**. The reactive
  runtime, the JCS canonicalizer, the multibase
  decoder, and the in-browser verifier are all
  vendored under `src/` and total under 4000 lines.
- Embeds as a **single custom element** with one
  attribute (`src`). No build step required for the
  host page; see "Using it in a host page" below.

If your project does need a different model (e.g.
DID-based authority discovery, X.509 cert chains,
issuer-hosted verification), the Transpareo Time Machine
is probably not the right fit. Forks are welcome.

## Using it in a host page

Three supported integration modes. Pick the one that
matches your stack:

### 1. CDN (`<script>` tag, no build step)

The npm package is mirrored at unpkg and jsdelivr at
versioned URLs. For drop-in script-tag use, load the
**embed bundle** - one URL, stylesheet inlined, no
ordering risk:

```html
<script type="module"
        src="https://unpkg.com/transpareo-time-machine@1.0.0/dist-embed/embed.js"></script>

<transpareo-time-machine
  src="https://cdn.example.com/acme/dpp/abc-123/manifest.json">
</transpareo-time-machine>
```

Pin a specific version (`@1.0.0`) for production. Use
`@latest` only in throwaway demos.

The embed bundle inlines `app.css` into a `<style>` it
injects at module init, so you do **not** need a
separate `<link rel="stylesheet">`. The renderer's
functional icons (controls, status) are bundled inline
and always render. The decorative content icons are
optional: host a sprite (`icons-src`) plus a
`propertyID`-to-icon map (`icon-map-src`); the package
ships neither (see "Icons"):

```html
<transpareo-time-machine
  src="https://your-cdn/manifest.json"
  icons-src="https://your-cdn/icons.svg">
</transpareo-time-machine>
```

If you are pulling the bundle into a host that already
manages its own CSS pipeline (and would rather keep the
stylesheet as a separate, fingerprint-able asset), load
the lib bundle instead:

```html
<link rel="stylesheet"
      href="https://unpkg.com/transpareo-time-machine@1.0.0/dist/transpareo-time-machine.css">
<script type="module"
        src="https://unpkg.com/transpareo-time-machine@1.0.0"></script>
```

Lib vs embed is a CSS-delivery choice; both expose the
same `<transpareo-time-machine>` element with identical
behaviour.

### 2. npm + a bundler (Vite, Next, webpack, etc.)

```bash
npm install transpareo-time-machine
```

```ts
// In your app's entry:
import 'transpareo-time-machine';
import 'transpareo-time-machine/style.css';
```

Then drop the element anywhere in your markup. The
package ships no icon sprite; the functional icons are
inline. For the decorative content icons, host your own
sprite (`icons-src`) and `propertyID`-to-icon map
(`icon-map-src`) (see "Icons").

For the standalone verifier-only widget (no Time
Machine SPA), import the secondary entry:

```ts
import 'transpareo-time-machine/dpp-verifier';
```

```html
<dpp-verifier></dpp-verifier>
```

If your bundler integration is more "drop a script tag
into the output" than "fully integrate the asset
graph" - e.g. you ship a server-rendered page and
manage CSS by hand - the `./embed` entry is also
exported:

```ts
import 'transpareo-time-machine/embed';
```

…which inlines `app.css` instead of pulling it as a
sibling import, so you don't need the
`'transpareo-time-machine/style.css'` line above.

### 3. Self-hosted bundle

If you want zero third-party runtime dependencies, build
once and host the artefacts on your own infrastructure:

```bash
git clone https://github.com/transpareo/transpareo-time-machine.git
cd transpareo-time-machine
npm install
npm run build:all
# Lib delivery (separate JS + CSS, bundler-friendly):
#   dist/transpareo-time-machine.{js,css}
#   dist/dpp-verifier.{js,css}
#   dist/locales/<lc>.js          (lazy locale chunks)
#
# Embed delivery (one JS file, CSS inlined, script-tag
# friendly):
#   dist-embed/embed.js
#   dist-embed/<lc>.js            (lazy locale chunks)
#
# Copy whichever delivery matches your host's CSS
# pipeline to your static host. The lib delivery
# matches the unpkg snippet in section 1's second
# block; the embed delivery matches the first block.
```

The build is reproducible from source; no network calls
at runtime beyond fetching the DPP artefacts themselves.

## Public API

The package ships two custom elements; both register
themselves on import as a side effect, so host pages
never call `customElements.define` directly.

TypeScript declarations ship with the package
(hand-written in `types/`, since the entries export no
runtime symbols): the tag names are registered in
`HTMLElementTagNameMap` so `querySelector` /
`createElement` return the typed elements, the
`transpareo-time-machine:state` event detail is typed via
`HTMLElementEventMap`, and the `openModal` options/handle
types are importable from the package root.

### `<transpareo-time-machine>`

The full passport renderer.

| Attribute | Required | Effect |
|-----------|----------|--------|
| `src` | yes | URL of the DPP manifest. Resolved against `document.location` if relative. Changing the attribute live triggers a re-fetch. |

| Surface | Notes |
|---------|-------|
| Events | `transpareo-time-machine:state` (see "Integration hook" below). |
| Slots | `additional` (see "Integration hook" below). |
| Methods | `openModal({ title, body, onClose? }) -> { close }` (see "Integration hook" below). |
| CSS parts | None today. The element has an open shadow root, so host pages can reach inner DOM via `::shadow`-style selectors but doing so is unsupported and may break on any release. |
| CSS custom properties | The publisher theming surface (see "Theming" below). Custom properties inherit through the shadow boundary, so any `--token` set on the host page applies inside. |
| Attributes | `src` (DPP **manifest** URL, or a single signed **snapshot** URL; see "Single-snapshot mode" below), `icons-src` (decorative content sprite), `icon-map-src` (per-publisher JSON mapping each property's `propertyID` to a sprite symbol id; pairs with `icons-src`), `revoked-roots-src` (revocation endpoint; `''` disables the boot check), `show-verification-mark` (`false` hides the verification chip), `pinned-platform-key` (whitespace-separated Multikey set; the chip must see one of them among the verified entries; also keys the revoked-roots check), `pinned-issuer-key` (whitespace-separated Multikey set of the issuer's declared signing keys - under BYOK the customer's own registered keys; the chip requires a verified issuer entry under one of them), `verifier` (present: mount `<dpp-verifier>` in place of the renderer), `footer-copyright` + `footer-links` (footer chrome; `footer-links` is a JSON array of `{ label, url }`). Read once in the element's `setup()` (`src/config.ts`). The standard `lang` attribute (e.g. `lang="de"`) pins the UI locale ahead of the browser preference; see "Localization" below. |

#### Single-snapshot mode

`src` may point at a single signed snapshot instead of a
manifest. The element detects which it was given; for a lone
snapshot it renders that one frozen version with no version
timeline, history, or EPCIS events (a snapshot carries no
version list), and the language picker is derived from the
snapshot's own localized strings. The snapshot's own 2-of-2
proof still verifies, so the chip reads "verified" on a
validly-signed snapshot. This is a weaker assurance than the
manifest flow: with no signed version list and no
cross-version chain, it proves the snapshot is authentic,
not that it is the current version of a history.

#### Integration hook

The renderer exposes one named slot and one custom
event so a host page can drop in extras (a leadgen
CTA, a recall banner, a regional disclosure, ...)
without coupling to the SPA's internals or forking
the bundle.

- **Slot**: `slot="additional"`. Renders at a stable
  position inside the card, directly above the
  composition donut. Light-DOM children of
  `<transpareo-time-machine>` with that `slot`
  attribute are projected into it. Branding CSS
  custom properties (the `--color-*` and `--font-*`
  tokens) cascade through the slot boundary, so a
  slotted button inherits the publisher's theme without
  extra wiring. An element with no children or no
  `slot="additional"` child renders nothing extra; the
  SPA fetches nothing on the integration's behalf.
  The slot is hidden while the visitor scrubs to a
  historical version and reappears when they return
  to the current version. The integration's slotted
  child stays attached the whole time; the SPA just
  stops projecting it during historical view. This
  is deliberate: marketing CTAs, recall banners, and
  similar extras apply to the live product, not to
  the regulatory record being scrubbed.
- **Event**: `transpareo-time-machine:state`. Fires
  on the host element (does not bubble) once the SPA
  is ready, and again whenever the active version,
  the active locale, or the manifest changes:

  ```ts
  tm.addEventListener('transpareo-time-machine:state', (e) => {
    const { code, locale, version, currentVersion, manifestUrl } = e.detail
    // ...fetch your config, build a slotted child, attach it...
  })
  ```

  The detail is intentionally identity-only, no
  snapshot content. The SPA never inspects the slot's
  content or the integration's network calls. If the
  integration script attaches its listener after the
  initial `'ready'` dispatch (script-load-order
  edge case), the next state change (version scrub,
  locale switch) re-fires the event; host shells that
  need the first dispatch should load the integration
  module immediately after the
  `<transpareo-time-machine>` element so the async
  manifest fetch settles after the listener attaches.
- **Method**: `tm.openModal({ title, body, onClose? })`.
  Opens a modal styled with the same chrome as the
  SPA's own modals (overlay, header with close button,
  scroll-locked body, Escape and click-outside
  dismissal). Returns `{ close }` for programmatic
  dismissal. The `onClose` callback fires on whichever
  close path triggers first; calling `close()` more
  than once is a no-op. At most one modal at a time:
  a second `openModal` call before the first is closed
  dismisses the first (fires its `onClose`) and
  replaces it. Safe to call from a `:state` listener;
  if called before the SPA has mounted, the modal
  renders as soon as the mount completes.

  ```ts
  tm.addEventListener('transpareo-time-machine:state', (e) => {
    // The event re-fires on every version / locale
    // change, so build the CTA only once.
    if (tm.querySelector(':scope > [slot="additional"]')) return
    const button = document.createElement('button')
    button.textContent = 'Sign up'
    button.addEventListener('click', () => {
      const body = document.createElement('div')
      body.textContent = 'Newsletter form goes here.'
      const handle = tm.openModal({
        title: 'Newsletter',
        body,
        onClose: () => { /* clean up your form state */ },
      })
      // handle.close() to dismiss programmatically.
    })
    const host = document.createElement('div')
    host.slot = 'additional'
    host.appendChild(button)
    tm.appendChild(host)
  })
  ```

### `<dpp-verifier>`

Standalone verification widget (no full passport
chrome). Imported via the subpath entry
`transpareo-time-machine/dpp-verifier`. Transpareo runs
it in production at
[transpareo.com/en/dpp-verifier](https://transpareo.com/en/dpp-verifier).

| Attribute | Required | Effect |
|-----------|----------|--------|
| `src` | no | Manifest URL. Pre-fills the input and verifies on connect. |
| `pinned-platform-key` | no | One or more multibase z-prefixed Ed25519 public keys, whitespace-separated (rotation keeps retired-but-sound keys in the set). An additional security layer for the host's own platform: it never gates pass/fail (foreign DPPs still verify on their own terms), it elevates the identity tier to the strongest claim when the signatures match one of the pins. |
| `lang` | no | Standard HTML locale for the widget UI (e.g. `lang="de"`, `lang="de-AT"`; the region is stripped). The verifier has no DPP `availableLocales` to detect from, so without this it stays English. Outranks the browser preference; a previously stored locale pick still wins. Only locales with a shipped label bundle apply. |

The widget verifies any DPP, and the banner says exactly
what was proven, in three identity tiers:

1. **Pinned** - a verified proof entry matched the
   page-supplied `pinned-platform-key` and the manifest
   signature verified under it. "Verified by {platform}"
   backed by a key the *page*, not the data, vouched for.
   This is the layer to deploy on your own verification
   surface.
2. **Bound** - no pin (or a foreign DPP): the signing
   keys resolved from the same domain the manifest's
   `platform.did` declares (`did:web`). Forging this
   requires controlling that domain, so the banner still
   reads "Verified by {platform}".
3. **Unconfirmed** - the signatures verify and the
   version chain holds, but nothing ties the keys to the
   declared platform identity. The banner reads
   "Signatures valid, signer identity unconfirmed"
   instead of carrying a name the data merely claims.

Signature failures, a broken chain, or an invalid
manifest signature fail the verdict outright in every
tier.

Same surface notes as `<transpareo-time-machine>` (open
shadow root, CSS custom properties, no events).

## Browser support

The renderer runs entirely in the visitor's browser.
Proof verification uses **Ed25519**: native WebCrypto
where the engine supports it, and a bundled pure-JS
fallback (`noble-ed25519`, lazily imported) everywhere
else, so the verification chip resolves to a real
verdict even on engines without native Ed25519. Keys
import as `spki`, the only format Firefox accepts for
Ed25519.

Native WebCrypto Ed25519 ships enabled by default in:

| Engine | Native Ed25519 since |
|--------|---------|
| Chrome / Edge | 137 (May 2025) |
| Firefox | 129 (August 2024) |
| Safari (macOS / iOS) | 17 (September 2023) |

Below those versions the fallback verifier runs instead
(slower, same verdict; its chunk downloads only when
native support is absent). The practical floor is then
set by the other web-platform features the bundle relies
on (custom elements, ES-module dynamic `import()`, shadow
DOM, CSS `color-mix()`), not by Ed25519 support.

## Quick start

For working on the renderer itself. (Consumers do not
need any of this; see "Using it in a host page" above.)

Prerequisites:

- Node 22+ (`package.json` `"type": "module"`)
- A Rails resolver is only needed in production; in
  dev the SPA fetches its DPP artefacts from Vite's
  own `/public/` after `npm run seed`.

```bash
npm install
npm run seed   # one-off: validates fixture YAML, fetches
               # external images, and writes the signed
               # JSON artefacts (manifest, per-version
               # snapshots, EPCIS document, issuer key
               # resolution docs) under
               # /public/<id>/dpp/<code>/.
npm run dev
```

Vite serves the SPA on `http://localhost:5173/` and
hot-reloads on save.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR; serves the nordic-wear demo. |
| `npm run dev:nordic` / `npm run dev:volturra` | Same dev server pointed at a specific seeded fixture. Set `SEED=<fixture-id>` to use any other `fixtures/*.yml`. |
| `npm run build` | Type-check + bundle into `dist/`. |
| `npm run preview` | Serve the built `dist/` locally. |
| `npm run check` | `tsc` over the SPA + the seed scripts + tests. |
| `npm test` | Vitest. Covers crypto (JCS, multibase, eddsa-jcs-sha256 aggregate verifier) and the reactive runtime. |
| `npm run seed` | Walk every `fixtures/*.yml`, validate against the zod schema, download remote images, write `branding.css` under `/public/<id>/`, and write the published JSON artefacts (manifest, per-version snapshots, EPCIS document, key resolution docs) under `/public/<id>/dpp/<code>/`. Generates a fresh Ed25519 keypair per fixture on each run; the produced snapshots are signed with these keys. Idempotent on image cache; output JSON overwrites. Re-run after pulling a fixture change. |
| `npm run check:fixtures` | Network-free Zod parse of every `fixtures/*.yml`. CI runs this on every push and PR to catch schema regressions without depending on third-party image hosts. |

## Fixtures

Each demo product is a single YAML file under
`fixtures/`, paired with a `fixtures/<id>/branding/`
folder for non-text assets (CSS body, logo, favicon).
The seed pipeline turns each YAML into the same shape
the production issuer writes to S3: one manifest,
one self-contained per-version snapshot, one EPCIS
document (the public events feed, with renderer-
specific fields carried as `transpareo:*` extensions),
and a Multikey resolution doc per signing authority.

```
fixtures/
  nordic-wear-tshirt.yml
  nordic-wear-tshirt/
    branding/
      branding.css        # :root issuer theme tokens
      logo.svg
      favicon.ico
  volturra-pulse-2000.yml
  volturra-pulse-2000/
    branding/
      branding.css
      logo.svg
      favicon.ico
```

The seed run produces, per fixture:

```
public/<id>/                              # gitignored
  branding.css                                # linked from the HTML shell
  branding/{logo.svg, favicon.ico}            # copied assets
  <fixture-image>.jpg                         # downloaded images
  dpp/<code>/
    manifest.json                             # entry point: versions[].url
                                                + epcisUrl + signature
    v/<N>.json                                # self-contained snapshots
                                                with priorVersionHash chain
                                                + 5-entry proof set
    epcis.json                                # EPCIS 2.0 events feed
                                                (with transpareo:* extensions)
    keys/{issuer,platform}.json               # Ed25519 Multikey docs
```

The output tree is gitignored, every dev re-runs the
seed after pulling a fixture change. The YAML sources
(under `fixtures/`) and the binary branding assets
(under `fixtures/<id>/branding/`) are tracked.

The schema lives in `scripts/seed/schema.ts` (zod),
the signer in `scripts/seed/signing.ts`, emission in
`scripts/seed/emit-artefacts.ts`.

## Seeding

`npm run seed` turns the tracked YAML fixtures into the
exact artefacts a production issuer would publish, so dev
runs against real signed data rather than mocks. Per
fixture it:

1. Validates the YAML against the Zod schema
   (`scripts/seed/schema.ts`).
2. Generates a fresh Ed25519 keypair per signing
   authority (issuer + platform) for that run.
3. Builds each version's snapshot, computes the
   `priorVersionHash` chain, signs the multi-entry proof
   set, and signs the manifest's version list with the
   platform key (`scripts/seed/signing.ts`).
4. Downloads and caches the external fixture images.
5. Writes the manifest, per-version snapshots, EPCIS
   event feed, branding assets, and Multikey resolution
   docs under `/public/<id>/dpp/<code>/`
   (`scripts/seed/emit-artefacts.ts`).

Because the keypairs are fresh on every run, the
signatures (and therefore the verification chip) are only
valid against the artefacts from the same seed run. The
output tree is gitignored, so re-run `npm run seed` after
pulling a fixture change. `npm run check:fixtures` runs
only step 1 (no network) and gates every push.

## Switching fixtures

The dev pages render whichever fixture `SEED` names.
`npm run dev` defaults to the nordic-wear demo; the two
named scripts switch the whole page in one shot:

```bash
npm run dev:nordic     # SEED=nordic-wear-tshirt
npm run dev:volturra   # SEED=volturra-pulse-2000
```

`SEED=<fixture-id> vite` works for any `fixtures/*.yml`.
The id and code are read from that YAML and substituted
into the `__SEED_ID__` / `__SEED_CODE__` tokens in
`index.html` and `verifier.html`, so both the branding
stylesheet and the manifest `src` follow the seed.
`snapshot.html` stays on nordic-wear: it pins one
specific version (`v/6.json`) that only that fixture has.

There is no build-time fixture selection; every seeded
DPP is still reachable from any dev session by its own
URL:

```
/nordic-wear-tshirt/dpp/demo-2026-t001/manifest.json
/volturra-pulse-2000/dpp/demo-2026-b001/manifest.json
```

Both are served by Vite from `/public/` after `npm run
seed`. Production hosts use the same shape but point at
wherever the manifest is published.

## Dev pages

Three HTML entry points live at the repo root for local
work; none ship in the npm package:

| Page | Loads | Use |
|---|---|---|
| `index.html` | `/src/main.ts` | The full `<transpareo-time-machine>` renderer. The default `npm run dev` page. |
| `verifier.html` | `/src/dpp-verifier.ts` | The standalone `<dpp-verifier>` widget (no passport chrome). Open `/verifier.html` while `npm run dev` is running. |
| `embed-example.html` | `dist-embed/embed.js` | Reference host page for the single-file embed build, and the canonical inline list of branding tokens (see "Theming"). Run `npm run build:embed` first; see the file's header comment. |
| `snapshot.html` | `/src/main.ts` | Single-snapshot mode: `src` points at one signed snapshot instead of a manifest, so the renderer shows that frozen version with no timeline/history. Open `/snapshot.html` while `npm run dev` is running. |

The embed delivery is also smoke-tested by
`tests/embed-smoke.spec.ts` (run under `npm run a11y`): it
loads the built bundle and asserts it registers the custom
element and inlines its CSS.

## What the SPA does on first paint

1. Browser parses the HTML shell, applies the issuer's
   `<link rel="stylesheet" href="/<id>/branding.css">`,
   loads the SPA bundle.
2. `<transpareo-time-machine>` reads its `src`
   attribute and hands it to `src/host.ts`, which
   fetches it and detects a manifest vs a single
   snapshot. For a manifest it then:
   1. Resolves `versions[currentVersion].url` and
      `epcisUrl` against the manifest URL.
   2. Fetches the current snapshot and the EPCIS
      document (the single public events feed) in
      parallel.

   For a single snapshot it stores that one version and
   leaves the manifest + EPCIS empty (so the timeline and
   events stay hidden).
3. `src/host.ts` exposes those fetched docs as signals
   that `src/state.ts` derives the renderer's view
   model from (active snapshot, events list, EPCIS
   lookup). The element only mounts its inner SPA tree
   once `host.loadState === 'ready'`; until then it
   shows a minimal loading shell.
4. `src/actions.ensureVersionLoaded` runs
   `verifySnapshot` from `src/crypto/verify.ts` against
   the current snapshot:
   - JCS-canonicalize the snapshot (without `proof`),
     SHA-256 the bytes.
   - For each of the 5 proof entries: fetch the
     verificationMethod's Multikey doc, import the
     Ed25519 public key, `crypto.subtle.verify` the
     signature against the document hash.
   - Apply the any-issuer-and-any-platform rule
     (default) or all-five (`{ mode: 'strict' }`) to
     produce the aggregate verdict.
   It also runs the priorVersionHash chain check
   against the manifest's claimed hash for the prior
   version.
5. The verification chip flips to its verified state
   once both checks pass for the active
   version; clicking the chip opens the proof modal
   with the per-entry chain plus per-version
   issuer/platform/chain status. Older versions are
   fetched + verified lazily as the visitor scrubs.

## Architecture

```
src/
  main.ts                     lib entry (npm + bundler delivery)
  embed.ts                    embed entry (script-tag delivery, CSS inlined)
  bootstrap-spa.ts            global token import + element register
  bootstrap.ts                first-paint orchestration
  host.ts                     fetch flow (manifest -> snapshot + EPCIS)
  state.ts                    signal store + computed derivations
                              (events derive from EPCIS extensions)
  actions.ts                  mutations (focus, scrub, snapshot load + verify)
  archive.ts                  manifest + signature types, VersionState
  epcis.ts                    EPCIS 2.0 ObjectEvent types
  pagination.ts               history dot strip math
  motion.ts                   eased animation primitives
  gestures.ts                 swipe / drag input
  icons.ts, config.ts
  revoked-roots.ts            boot-time pinned-key revocation check
  types.ts                    localized-scalar tx() + shared types
  errors.ts                   describeError() for failure messages
  crypto/
    jcs.ts                    RFC 8785 canonicalizer
    multibase.ts              z-base-58 encode/decode
    verify.ts                 eddsa-jcs-sha256 verifier + aggregate verdict
  i18n/                       label loaders + native locale names
  reactive/                   tiny signals + html`` template runtime
                              (no external framework). See
                              src/reactive/README.md for the
                              contributor reference.
  components/                 web components (`<dpp-…>` custom elements,
    dpp-brandbar.ts             vanilla TS over reactive/)
    dpp-deck.ts
    dpp-hero.ts
    dpp-composition-donut.ts
    dpp-property-cards.ts
    dpp-badge-lists.ts
    dpp-accordions.ts
    dpp-manufacturer.ts
    dpp-timeline.ts             shim that imports ./timeline/index
    timeline/                   index.ts (class), layout.ts (math),
                                ticks.ts (axis), connectors.ts (SVG)
    dpp-verification-chip.ts
    dpp-verification-modal.ts
    dpp-event-modal.ts
    dpp-footer.ts
    dpp-gallery.ts
    dpp-lightbox.ts
    transpareo-time-machine.ts (the outer custom element + src observer)
  styles/                     SCSS, `@use`-chained from
    transpareo-time-machine.scss
    dpp.scss                  vendored from the Transpareo resolver
    dpp-*.scss                per-component sheets
    app.css                   issuer-token derivations + base reset
```

Production builds contain zero fixture data. `npm run
build` produces a bundle that fetches its DPP at
runtime from whatever URL the element's `src` names.

The runtime is custom: `src/reactive/` provides a tiny
signal primitive plus an `html` template tag that
mounts into a custom element. No Svelte, React, Lit, or
Vue. Components mirror the Transpareo resolver's class
hierarchy (`<div class="dpp-hero">`, `<h1 class="dpp-product-name">`,
etc.) so the vendored stylesheets apply directly.

`dpp.scss` and `dpp-gallery.scss` are vendored copies of
the Transpareo resolver's stylesheets; Transpareo
maintainers sync them when the resolver styles change
(gallery variables are re-resolved to CSS custom
properties on the way in, since the SPA bundle carries no
upstream `_variables.scss`). Treat both as upstream
files: prefer fixing styles in `dpp-*.scss` component
sheets over patching the vendored pair.

## Theming

Publisher theme tokens are CSS custom properties, shipped
in the publisher's `branding.css` (the Style Editor
export). The SPA's stylesheets read each via
`var(--token, fallback)`, so a publisher that omits a
token still renders with the SPA defaults.

The complete, annotated set the renderer reads is set
inline in the `:root` block of
[`embed-example.html`](embed-example.html), which doubles
as the canonical reference; the list lives in one place
rather than drifting between a doc and the code.

Every publisher's `branding.css` is the Style Editor
export, trimmed only of tokens with no SPA surface
(`--menu-color-*`, no nav menu; `--keyvisual-url`, no
banner image surface). A few exported tokens
(`--color-highlight*`) are kept for theme completeness
without yet being read by the SPA stylesheets; this is
deliberate, the branding export is treated as a complete
theme, not trimmed to current usage.

The typeface follows the same token model: the SPA
bundles no webfont and makes no external font request.
A publisher's `branding.css` sets `--font-family` and,
for a non-system typeface, ships the matching
`@font-face`; with no branding (standalone use or the
verifier surface) the renderer falls back to the system
sans stack baked into `--font-sans`.

## Icons

Icons come in two tiers so the renderer's own controls
never depend on an externally hosted asset:

- **Functional icons** (controls and status: close,
  expand, spinner, chevrons, download, history, etc.) ship
  inline in the bundle as a small sprite injected into the
  shadow root on boot. They always render, even with no
  content sprite configured.
- **Decorative / content icons** (the publisher's icon
  vocabulary) come from an external sprite the host
  supplies via `icons-src`, plus a per-publisher map
  supplied via `icon-map-src` that resolves each
  property's `propertyID` to a sprite symbol id - the
  signed snapshot carries no icon, so presentation stays
  out of the data. The sprite is fetched and injected into
  the shadow root so a bare `#id` reference resolves
  same-origin. (A cross-origin `<use href>` is blocked by
  the browser's same-origin rule, which no CORS header can
  lift, hence fetch and inject.) In dev they default to
  the seeded `/icons.svg` and `/<id>/icon-map.json`; a
  production build has no default. When a content sprite
  is configured the host gains a `data-icons` attribute,
  and the stylesheet reserves space for decorative icons
  only then, so a host or fork without a sprite shows no
  empty icon boxes.

The published package ships the functional icons (inline
in the JS) but no decorative sprite. The full sprite lives
at `public/icons.svg` for `npm run dev` and is what the
Transpareo platform publishes to its CDN; consumers point
the `icons-src` attribute at their own sprite (or that CDN
copy). Several sprite glyphs are converted icon-font
artwork; see THIRD-PARTY-LICENSES.md for attribution.

### The icon map

`icon-map-src` is a flat JSON object keyed by each
property's `propertyID` (the vocabulary term the snapshot
ships), with sprite symbol names as values:

```json
{ "transpareo:carbonFootprint": "leaf",
  "transpareo:materialComposition": "sliders" }
```

A property whose `propertyID` is absent from the map
renders with no icon, and the symbol it names must exist
in the sprite. Like the sprite, the map is a publisher
resource served by URL, so one map can drive every
passport. The snapshot itself never carries an icon.

### Referencing an icon

Every icon is a `<symbol>` addressed by its id. In code,
call `icon()` with the bare family name; it adds the
`icon-` prefix and emits `<use href="#id">`:

```ts
icon('leaf')         // <use href="#icon-leaf">
icon('chevron-down') // alias, verbatim: #chevron-down
```

`chevron-down` and `spinner` are utility aliases that skip
the prefix. A property's decorative icon is resolved from
its `propertyID` through the `icon-map-src` table, and a
rating maps to a smiley (`smiley-good` ->
`#icon-smiley-good`); either way the named symbol must
exist in the configured content sprite. In raw template
markup, reference a symbol with the bare fragment:
`<use href="#icon-leaf">`.

## Dev wiring

`vite.config.ts` proxies these paths to
`https://backend.dev` (override with
`DPP_ARCHIVE_ORIGIN=...`):

| Path | What it serves |
|---|---|
| `/dpp/*` | DPP manifest, EPCIS document, version blobs (currently unused at runtime, fixtures cover everything; reserved for a future live-archive mode). |
| `/.well-known/*` | DPP signing keys. |
| `/admin/fonts/*` | The shared icon font. |
| `/app/*` | Plus Jakarta Sans + Lato (`Headline`) variable fonts. |
| `/media/*` | Publisher mediafile bucket (logo + product images). |
| `/branding.css` | Issuer branding stylesheet. A production embed serves one publisher per page here; the dev shell links `/<id>/branding.css` so one server can serve several seeded fixtures. |

The proxy uses `secure: false` only for local-host
targets (`*.dev`, `*.local`, `127.0.0.1`, etc.) so the
resolver's self-signed dev cert doesn't trip Vite;
real-cert staging / production hosts get full TLS
verification. Override with `DPP_ARCHIVE_INSECURE=1`
if you need to force-skip on a non-local host.

## Localization

Two layers:

- **DPP content** (product names, event descriptions,
  etc.), comes from the snapshot's per-locale fields.
  Scalar localized strings are compact
  `{ locale: value }` hashes (declared in the
  snapshot's JSON-LD `@context` with
  `@container: @language`); single-locale fields stay
  as plain strings. The renderer's `tx()` helper in
  `src/types.ts` accepts either shape.
- **SPA UI labels** (chip text, proof modal headings,
  event-type labels, etc.), bundled JSON files
  under `src/i18n/data/`, one per locale, lazy-loaded
  via Vite. All 39 bundled locales ship.

The locale picker reads `availableLocales` from the
DPP and shows native names from `src/i18n/index.ts`.
Detection order: `localStorage` (the user's stored pick),
then the host page's `lang` attribute when it names an
available locale, then `navigator.languages`, then the
first available locale. The standalone `<dpp-verifier>`
has no DPP locales to draw on, so it resolves `lang`
against the set of shipped label bundles instead.

> Label caveats (`byActor` rendering as colon-style in
> ja/ko/zh/ru/uk/tr; binary pluralisation in
> `cryptoProof.snapshotsVerified*` not handling Slavic
> plural classes) are documented in
> `src/i18n/data/README.md`.

> **Direction.** All 39 bundled locales are
> left-to-right. The SPA's stylesheets use physical
> properties (`left`, `right`, `margin-left`, etc.)
> and the renderer does not switch
> `document.documentElement.dir`, so dropping an
> Arabic, Hebrew, Persian, or Urdu label file in is
> **not** sufficient to get a correct RTL render.
> RTL support is tracked separately; until it lands,
> publishers shipping to RTL markets need a forked
> bundle.

## Notes

- The Gallery overlay (lightbox) re-parents the
  `.gallery` element to `document.body` on open,
  same trick the resolver's `gallery.js` uses to
  escape ancestor selectors. See
  `src/components/dpp-lightbox.ts`.
- The verification chip in `dpp-verification-chip.ts`
  becomes clickable once verification resolves; clicks
  open the proof modal.
- The copy button in the EPCIS raw view
  (`dpp-event-modal.ts` `.epcis-copy`) is the only
  surface that consumes `--button-color-*`. Other
  buttons in the SPA live inside the timeline trough
  and have their own scrubber-friendly styling.
- The seeded output under `/public/<id>/dpp/...`
  and `/public/<id>/branding.css` is gitignored;
  the YAML sources and `fixtures/<id>/branding/`
  assets are the only tracked inputs.

## Releasing

`npm run release` cuts a release. It bumps the version,
stamps the `CHANGELOG.md` `[Unreleased]` block into a dated
section, commits `Release <version>`, tags `v<version>`, and
pushes. The pushed tag is the release: it triggers
`.github/workflows/release.yml`, which type-checks, lints,
tests, builds, runs the a11y pass against a fresh seed, and
publishes to npm with provenance. The helper runs the
check / lint / test gates locally first, so a broken release
never becomes a dangling tag.

```bash
npm run release -- -m   # minor (0.x.0)
npm run release -- -M   # major (x.0.0)
npm run release         # patch (0.0.x), the default
npm run release -- -n   # dry run: print the steps only
```

Releases go out from a clean `main`. The git tag and
`package.json` version must agree (the workflow enforces
`v<version>` == `package.json`), which is exactly what the
helper produces. Pick the bump by semver: a consumer-visible
break, such as a change to the proof cryptosuite, is a major.

## Contributing

External contributions are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the issue-first
workflow, the pre-push checklist, the commit-message
convention, and the locale-file and fixture notes.
The [Code of Conduct](CODE_OF_CONDUCT.md) applies to
all project spaces.

Security vulnerabilities go through a private channel,
not GitHub issues. See [SECURITY.md](SECURITY.md) for
the reporting flow, supported versions, and disclosure
timeline.

By contributing you agree to license your changes
under [GPL-3.0-or-later](LICENSE), matching the rest
of the codebase.
