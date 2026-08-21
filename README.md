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
renders three sample passports end to end: a Nordic Wear
t-shirt (signed with `eddsa-jcs-2022`, minimally themed),
a Volturra Pulse 2000 (signed with the `ecdsa-sd-2023`
selective-disclosure suite, aggressively themed - the two
together showcase how far the branding tokens stretch),
and an Atelier Barro vase, an unsigned single-snapshot
passport with no manifest, showing how the renderer
presents a bare foreign DPP with no verification chrome
or custom styling. Scrub the timeline and watch the
verification chip in action on both proof types.

Embedding it is one custom-element tag. The simplest
`src` is the passport URL itself - the URL the QR code
on the product resolves to, here in its minimal
standardised form, a GS1 Digital Link carrying just
the 14-digit GTIN:

```html
<transpareo-time-machine
  src="https://example.com/01/09524000059109">
</transpareo-time-machine>
```

That is just an example - any DPP URL works. The
European DPP standards require a passport URL to
answer with the JSON dataset when a client asks for
JSON via HTTP content negotiation (the EN 18216
baseline), and the renderer asks exactly that way: it
requests its `src` with
`Accept: application/ld+json, application/json`.
From the single dataset such a URL returns, the
Transpareo Time Machine renders in single-snapshot
mode: the current version with its verification
chip, no timeline - one document carries no history.

The ***full*** Time Machine - the timeline a visitor scrubs
back through, per-version verification, the hash
chain binding each version to its predecessor - needs
a version index, and the standards do not provide
one: EN 18221 obliges publishers to archive every
version, but the standardised API reaches the archive
one date-query at a time (`ReadDPPVersionByIdAndDate`,
optional for the operator) and has no method that
lists versions. The manifest is this package's
convention for exactly that gap: one signed document
naming every version with its URL, hash, and date.
Point `src` at it and the timeline lights up:

```html
<transpareo-time-machine
  src="https://example.com/01/09524000059109/manifest.json">
</transpareo-time-machine>
```

The manifest can live anywhere you can serve a URL.
The renderer assumes nothing about where or how you
host: it reads each artefact's address from the
manifest (relative URLs resolve against the
manifest's own URL), so you publish wherever you
like. Its structure is documented in "The manifest"
below.

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
  embedded `eddsa-jcs-2022` proof set, never from a
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

## The manifest

The manifest is the version index of a passport: one
signed JSON document listing every published version,
so a client can enumerate the history that the
standardised DPP APIs otherwise expose only one
date-query at a time. Everything else the renderer
touches is named by it - each version's snapshot at
`versions[].url`, the events document at `epcisUrl` -
so the renderer never assumes a path layout in your
bucket. A trimmed real manifest:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://transpareo.com/contexts/dpp/v1"
  ],
  "@type": "DppManifest",
  "code": "demo-2026-t001",
  "issuer": {
    "@type": "Organization",
    "name": "Nordic Wear",
    "did": "did:web:nordic-wear.example"
  },
  "platform": {
    "@type": "Organization",
    "name": "Transpareo",
    "did": "did:web:transpareo.example"
  },
  "availableLocales": ["en", "de", "fr"],
  "currentVersion": 6,
  "versions": [
    {
      "number": 1,
      "publishedAt": "2024-01-15T10:00:00Z",
      "reason": "Initial publication",
      "hashValue": "5a52500ff539...",
      "url": "v/1.json",
      "sizeBytes": 10812
    },
    {
      "number": 6,
      "publishedAt": "2026-04-05T13:45:00Z",
      "reason": "Repair documented",
      "hashValue": "dc65871414b2...",
      "url": "v/6.json",
      "sizeBytes": 11943,
      "privateProperties": {
        "url": "https://api.nordic-wear.example/dpps/demo-2026-t001/private_properties/6"
      }
    }
  ],
  "epcisUrl": "epcis.json",
  "signedAt": "2026-04-05T13:45:00Z",
  "signature": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "created": "2026-04-05T13:45:00Z",
    "verificationMethod": "keys/platform.json",
    "proofPurpose": "assertionMethod",
    "proofValue": "z5owR9zthjFC..."
  }
}
```

Field notes:

- `versions[]` - one entry per published version.
  `url` points at the version's signed snapshot;
  relative URLs resolve against the manifest's own
  URL. `hashValue` (with optional `hashAlgorithm` /
  `hashCanonicalForm`) is the snapshot's content
  hash; the next version's snapshot names it as
  `priorVersionHash`, the chain check that binds the
  history together. `publishedAt` anchors the
  version's timeline dot, `reason` is the
  human-readable change label, `sizeBytes` the
  snapshot's size on the wire.
- `currentVersion` - the version rendered on first
  paint; the timeline scrubs backward from there.
- `versions[].privateProperties.url` (optional) - a
  publisher-hosted endpoint returning the login-gated
  property rows the current user may read. Present
  only on versions carrying such rows. When it is,
  the renderer fetches it anonymously and branches on
  the status: 200 merges the returned rows, 401
  surfaces a sign-in button that hands off to the
  publisher's own login page. That hand-off carries
  `return=` (where to come back to) and `locale=` (the
  language the visitor is reading the passport in, as
  the passport declares it). A login URL that already
  names a locale is passed through untouched, which is
  how an issuer opts out.
- `versions[].registeredAt` / `registrationProof`
  (optional) - EU-registry round-trip metadata,
  surfaced in the proof modal when present.
- `availableLocales` - the locales this passport is
  published in; drives the footer language picker.
- `epcisUrl` - the EPCIS 2.0 events document the
  event timeline derives from.
- `issuer` / `platform` - schema.org-style
  attribution blocks; their `did` identities are
  matched against the snapshot proof entries.
- `signature` - a W3C Data Integrity proof
  (`eddsa-jcs-2022`, platform key) over the manifest
  body. The renderer verifies it and folds the
  outcome into every version verdict, so a tampered
  version list cannot present itself as verified.

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
        src="https://unpkg.com/transpareo-time-machine@2.14.1/dist-embed/embed.js"></script>

<transpareo-time-machine
  src="https://cdn.example.com/acme/01/09524000059109/manifest.json">
</transpareo-time-machine>
```

Pin a specific version (`@2.14.1`) for production. Use
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
  src="https://cdn.example.com/acme/01/09524000059109/manifest.json"
  icons-src="https://cdn.example.com/acme/icons.svg">
</transpareo-time-machine>
```

If you are pulling the bundle into a host that already
manages its own CSS pipeline (and would rather keep the
stylesheet as a separate, fingerprint-able asset), load
the lib bundle instead:

```html
<link rel="stylesheet"
      href="https://unpkg.com/transpareo-time-machine@2.14.1/dist/transpareo-time-machine.css">
<script type="module"
        src="https://unpkg.com/transpareo-time-machine@2.14.1"></script>
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

### Content Security Policy on the host page

A page that sets a CSP has to allow what verification
reads, and one of those hosts is not visible anywhere in
the page's own markup: a proof names its key by
`verificationMethod`, and the renderer resolves that to
whatever host the artefact points at. A key the page
cannot fetch is a key its proof cannot be judged under,
so once every alias of an authority sits on a blocked
host, the chip reads "Verification failed" rather than
anything about a blocked request. The browser logs the
real cause as a CSP report.

`connect-src` needs:

- the origin serving the manifest, the snapshots and the
  EPCIS events, wherever `src` points;
- **every host a `verificationMethod` resolves to** - the
  issuer's key host and the platform's, including the
  `did:web` hosts, which resolve to
  `https://<host>/.well-known/did.json`. Read them off a
  snapshot's `proof[].verificationMethod`;
- the revocation endpoint when the page pins a platform
  key: `https://transpareo.com` by default, or whatever
  `revoked-roots-src` names (`revoked-roots-src=""`
  disables the check and the fetch with it);
- the hosts serving `icons-src` and `icon-map-src`, when
  those are set.

The rest follows the assets a passport renders with:
`img-src` for product imagery and the brandbar logo,
`style-src` and `font-src` for the publisher's branding
stylesheet and the typeface it declares, `script-src` for
wherever the bundle is served from.

A passport page needs no sockets and no payment SDK, so a
policy inherited from a wider application is usually both
too permissive in what it grants and too narrow where it
counts. The example policy in `embed-example.html` is
deliberately loose (`connect-src 'self' https:`); tighten
it host by host, and keep the key hosts in.

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
| `src` | yes | URL of the DPP manifest, of a single signed snapshot, or the passport URL of a publisher that serves JSON via content negotiation. Resolved against `document.location` if relative. Changing the attribute live triggers a re-fetch. |

| Surface | Notes |
|---------|-------|
| Events | `transpareo-time-machine:state` (see "Integration hook" below). |
| Slots | `additional` (see "Integration hook" below). |
| Methods | `openModal({ title, body, onClose? }) -> { close }` (see "Integration hook" below). |
| Properties | `state` (read-only): the same detail the `:state` event carries, or `null` before the manifest has loaded. |
| CSS parts | None today. The element has an open shadow root, so host pages can reach inner DOM via `::shadow`-style selectors but doing so is unsupported and may break on any release. |
| CSS custom properties | The publisher theming surface (see "Theming" below). Custom properties inherit through the shadow boundary, so any `--token` set on the host page applies inside. |
| Attributes | `src` (DPP **manifest** URL, or a single signed **snapshot** URL; see "Single-snapshot mode" below), `icons-src` (decorative content sprite), `icon-map-src` (per-publisher JSON mapping each property's `propertyID` to a sprite symbol id; pairs with `icons-src`), `revoked-roots-src` (revocation endpoint; `''` disables the boot check), `show-verification-mark` (`false` always hides the verification chip, `true` always shows it; absent, the chip hides itself for a lone snapshot that carries no proof), `pinned-platform-key` (whitespace-separated Multikey set; the chip must see one of them among the verified entries; also keys the revoked-roots check), `pinned-issuer-key` (whitespace-separated Multikey set of the issuer's declared signing keys - under BYOK the customer's own registered keys; the chip requires a verified issuer entry under one of them), `verifier` (present: mount `<dpp-verifier>` in place of the renderer), `logo-href` (where the brandbar logo links to, typically the publisher's home page; absent, the logo stays plain artwork), `footer-copyright` + `footer-links` (footer chrome; `footer-links` is a JSON array of `{ label, url }`). Read once in the element's `setup()` (`src/config.ts`). `locale` states which language to render in: a tag (`locale="de"`), `inherit` to follow the language surrounding the element, or `auto` (the default, and what an absent attribute means) to detect from the visitor's browser. It outranks the standard `lang` attribute, which is still read where no `locale` is given, so `locale="auto"` is how a page that templates `lang` everywhere keeps detection. Either pins the UI locale ahead of the browser preference and of a locale the visitor picked on another page; see "Localization" below. |

#### The verification mark

The chip in the brandbar surfaces the active version's
verification state and opens the proof modal on click.
Its states: a spinner while proofs verify, "Verified by
<name>" (or the neutral "Verified" when no platform name
is earned), "Verification failed", "Not yet published"
(an unsigned draft; inert, no modal), and the muted
question mark "Not verifiable" - nothing was judged
either way, because the snapshot carries no proof or its
proof names a cryptosuite this build does not ship; the
modal states which.

`show-verification-mark` controls whether the chip
renders at all:

| Value | Behaviour |
|---|---|
| absent | Auto. The chip shows, except for a lone snapshot carrying no proof: a DPP that never claimed verifiability is not badged for lacking it, so the renderer stays a neutral viewer for unsigned passports. Under a manifest the chip always shows, since a missing snapshot proof there means a signed publication was stripped, and the question mark must surface that. |
| `"true"` | Always show, including the question mark on an unsigned lone snapshot. |
| `"false"` | Never show. |

When neither the chip nor a themed logo (`--logo-url`)
renders, the brandbar is omitted entirely rather than
left as an empty sticky header, and the card content
keeps a padded top edge (1.5x its vertical padding) in
its place.

The logo is plain artwork unless `logo-href` names a
destination, typically the publisher's own home page; with
it, the logo renders as a link there. Only a logo the theme
actually supplies is linked, so a chip-only bar gains no
invisible click target, and the URL passes the same scheme
guard as the footer links: a `javascript:` value leaves the
logo unlinked rather than armed. The artwork carries no
text, so the link takes a localized accessible name
("Home page") instead of announcing its own URL.

#### Single-snapshot mode

`src` may point at a single signed snapshot instead of a
manifest. This is also what a passport URL resolves to when
the publisher serves JSON via content negotiation: every
artefact fetch carries
`Accept: application/ld+json, application/json`, and the
dataset such a URL returns is one snapshot, the passport's
current version. The element detects which shape it was
given; for a lone snapshot it renders that one frozen
version with no version timeline, history, or EPCIS events
(a snapshot carries no version list), and the language
picker is derived from the snapshot's own localized
strings. The snapshot's own 2-of-2
proof still verifies, so the chip reads "verified" on a
validly-signed snapshot. This is a weaker assurance than the
manifest flow: with no signed version list and no
cross-version chain, it proves the snapshot is authentic,
not that it is the current version of a history.

A snapshot that carries no proof at all is not treated as
a failed verification - there is nothing to judge either
way. By default such a lone snapshot renders with no
verification chrome; "The verification mark" above has
the full policy and the `show-verification-mark`
overrides. Where the chip does render, it shows the
muted question mark straight from the data, with no
verifying phase, and its modal explains that no
verification is possible, naming the cryptosuite when an
unshipped proof format is the cause. The
standalone `<dpp-verifier>` widget agrees on all of it:
manifest-or-snapshot detection is one shared rule
(`src/artefact-detect.ts`), a pasted snapshot URL is
judged on its own proof set (the identity tier stays at
"signer identity unconfirmed" without a manifest to bind
a name to, unless a pinned key matches), and an unsigned
or unreadable one gets the same neutral notice instead of
a red failure card.

#### Integration hook

The renderer exposes one named slot, one custom event,
one property, and one method so a host page can drop in
extras (a leadgen CTA, a recall banner, a regional
disclosure, ...) without coupling to the SPA's
internals or forking the bundle.

- **Slot**: `slot="additional"`. Renders at a stable
  position inside the card, directly above the
  composition donut. Light-DOM children of
  `<transpareo-time-machine>` with that `slot`
  attribute are projected into it. More than one such
  child is supported, projected in light-DOM source
  order, so independent integrations can each slot
  their own CTA without composing a shared wrapper.
  Branding CSS custom properties (the `--color-*` and
  `--font-*` tokens) cascade through the slot boundary,
  so a slotted button inherits the publisher's theme
  without extra wiring. An element with no children or no
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
  is ready, and again on every timeline step, locale
  switch, and manifest change:

  ```ts
  tm.addEventListener('transpareo-time-machine:state', (e) => {
    const { code, locale, version, currentVersion, manifestUrl } = e.detail
    // ...fetch your config, build a slotted child, attach it...
  })
  ```

  The detail is intentionally identity-only, no
  snapshot content. The SPA never inspects the slot's
  content or the integration's network calls.

  The event is a "here is the current identity"
  signal, not a change notification: it re-dispatches
  on every timeline step, including steps between two
  events that resolve to the same version number, so
  the detail is often identical to the previous one.
  Every handler must be idempotent. Note also that a
  URL hash is a deep link to a historical version, so
  for those loads the very first dispatch already
  carries `version !== currentVersion` and the slot
  starts hidden; an integration that opens a modal by
  itself should gate on `version === currentVersion`.
  The event has no replay, so an integration script
  that attaches its listener after the initial
  `'ready'` dispatch would otherwise wait for the next
  state change to learn anything. Read `tm.state` once
  when attaching the listener and follow the event from
  there; it returns the same detail, or `null` if the
  manifest has not loaded yet, in which case the first
  dispatch is still to come.
- **Property**: `tm.state`, read-only. The same detail
  the event carries, or `null` before the manifest has
  loaded. It is a live read, not a copy of the last
  dispatch, so it is also the way to answer "is the
  visitor on the current version right now" outside a
  listener:

  ```ts
  const s = tm.state
  if (s && s.version === s.currentVersion) {
    // ...safe to show a CTA or open a modal
  }
  ```
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
    // The event re-fires on every step, and another
    // integration may have slotted a child of its own,
    // so dedupe on a marker this integration owns
    // rather than on the slot name.
    if (tm.querySelector(':scope > [data-newsletter-cta]')) return
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
    const wrap = document.createElement('div')
    wrap.slot = 'additional'
    wrap.dataset.newsletterCta = ''
    wrap.appendChild(button)
    tm.appendChild(wrap)
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
| `pinned-platform-key` | no | One or more multibase z-prefixed public keys, whitespace-separated (Ed25519 for `eddsa-jcs-2022` snapshots, P-256 for `ecdsa-sd-2023` ones; a publisher's history can span both, and rotation keeps retired-but-sound keys in the set). An additional security layer for the host's own platform: it never gates pass/fail (foreign DPPs still verify on their own terms), it elevates the identity tier to the strongest claim when the signatures match one of the pins. |
| `locale` | no | Which language to render the widget in: a tag (`locale="de"`), `inherit` to follow the language surrounding the element, or `auto` (the default, and what an absent attribute means) to detect from the visitor's browser. Outranks `lang`. Only locales with a shipped label bundle apply. |
| `lang` | no | Standard HTML locale for the widget UI (e.g. `lang="de"`, `lang="de-AT"`; the region is stripped). The verifier has no DPP `availableLocales` to detect from, so without this it stays English. Outranks the browser preference and any locale the visitor picked on another page; a pick they made on a page carrying this same `lang` still wins, so an in-page picker keeps its promise. Only locales with a shipped label bundle apply. |

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
shadow root, CSS custom properties, no events). The widget
states no width of its own and fills the element's box, so
the page sets the measure by sizing the container it drops
the element into.

## Proof cryptosuites

A snapshot's embedded proof names its `cryptosuite`, and the
verifier dispatches on it, so one build verifies either:

- **`eddsa-jcs-2022`** - a whole-document Ed25519 proof set
  (issuer + platform, multi-authority). JCS-canonicalize the
  snapshot without its proof, SHA-256, verify each entry.
  The Nordic Wear demo uses this.
- **`ecdsa-sd-2023`** - a W3C selective-disclosure proof
  (P-256, RDF Dataset Canonicalization). Each snapshot is a
  Verifiable Credential whose proof commits to each statement
  independently, so a per-reader subset of fields can be
  disclosed and still verify. The Volturra Pulse 2000 demo
  uses this.

Both verifiers are hand-written and vendored under
`src/crypto/`, with no runtime dependencies. The two cached
JSON-LD contexts the ecdsa-sd path canonicalizes against
(`src/contexts/`) ship with the bundle, so verification stays
fully offline.

**Verify it yourself.** The proof modal (opened from the
verification chip) prints, for the active version, the
snapshot's cryptosuite and the verificationMethod URL of every
key that signed it, and each version row has a download button
for the raw signed snapshot. To reproduce a check without this
code:

- **`eddsa-jcs-2022`** - strip the `proof` array,
  JCS-canonicalize (RFC 8785) the remaining document and
  SHA-256 it; then for each proof entry SHA-256 its proof
  options, concatenate the two hashes, and Ed25519-verify
  against the key its verificationMethod resolves to.
  `src/crypto/verify.ts` is the reference.
- **`ecdsa-sd-2023`** - follow the W3C ecdsa-sd-2023 verify
  algorithm: parse the CBOR `proofValue`, RDFC-canonicalize the
  document against the cached contexts, and P-256-verify the
  base signature over `proofHash || publicKey || mandatoryHash`
  plus each disclosed statement. `src/crypto/ecdsa-sd.ts` is the
  reference.

## Browser support

The renderer runs entirely in the visitor's browser.
`eddsa-jcs-2022` verification uses **Ed25519**: native
WebCrypto where the engine supports it, and a bundled pure-JS
fallback (`noble-ed25519`, lazily imported) everywhere else,
so the verification chip resolves to a real verdict even on
engines without native Ed25519. Keys import as `spki`, the
only format Firefox accepts for Ed25519. `ecdsa-sd-2023` uses
**P-256**, which every WebCrypto engine supports natively, so
it needs no fallback.

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
| `npm test` | Vitest. Covers crypto (JCS, multibase, eddsa-jcs-2022 aggregate verifier) and the reactive runtime. |
| `npm run seed` | Walk every `fixtures/*.yml`, validate against the zod schema, download remote images, write `branding.css` under `/public/<id>/`, and write the published JSON artefacts (manifest, per-version snapshots, EPCIS document, key resolution docs) under `/public/<id>/dpp/<code>/`. Generates a fresh Ed25519 keypair per fixture on each run; the produced snapshots are signed with these keys. A `publication: single-snapshot` fixture with `proof_suite: none` emits just one unsigned `snapshot.json` instead (no manifest, no keys). Idempotent on image cache; output JSON overwrites. Re-run after pulling a fixture change. |
| `npm run check:fixtures` | Network-free Zod parse of every `fixtures/*.yml`. CI runs this on every push and PR to catch schema regressions without depending on third-party image hosts. |

## Fixtures

Each demo product is a single YAML file under
`fixtures/`, optionally paired with a
`fixtures/<id>/branding/` folder for non-text assets
(CSS body, logo, favicon). The seed pipeline turns each
YAML into the same shape the production issuer writes
to S3: one manifest, one self-contained per-version
snapshot, one EPCIS document (the public events feed,
with renderer-specific fields carried as
`transpareo:*` extensions), and a Multikey resolution
doc per signing authority.

The third fixture deviates on purpose:
`atelier-barro-vase` declares
`publication: single-snapshot` and `proof_suite: none`,
so it emits one frozen, unsigned `snapshot.json` and
nothing else - no manifest, no EPCIS, no keys, and no
branding folder. That is the shape of a foreign DPP
published without a version history, and it drives the
renderer's question-mark "Not verifiable" chip and the
verifier's nothing-to-judge notice.

```
fixtures/
  atelier-barro-vase.yml  # unsigned single snapshot,
                          # no branding on purpose
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

The seed run produces, per manifest fixture:

```
public/<id>/                              # gitignored
  branding.css                                # linked from the HTML shell
  branding/{logo.svg, favicon.ico}            # copied assets
  icon-map.json                               # row key -> sprite symbol table
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

A `publication: single-snapshot` fixture reduces to:

```
public/<id>/
  icon-map.json
  dpp/<code>/
    snapshot.json                             # one frozen version; with
                                                proof_suite: none, no proof
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

A `publication: single-snapshot` fixture skips the
manifest and EPCIS artefacts; with `proof_suite: none`
it also skips steps 2 and 3 entirely - no keypair, no
signatures, one bare `snapshot.json`.

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

`SEED=<fixture-id> vite` works for any manifest-publishing
`fixtures/*.yml`. The id and code are read from that YAML
and substituted into the `__SEED_ID__` / `__SEED_CODE__`
tokens in `index.html` and `verifier.html`, so both the
branding stylesheet and the manifest `src` follow the
seed. `snapshot.html` stays on nordic-wear: it pins one
specific version (`v/6.json`) that only that fixture has.
`atelier-barro-vase` is not a `SEED` target (it has no
manifest for those tokens to point at); its own page is
`unsigned.html`.

There is no build-time fixture selection; every seeded
DPP is still reachable from any dev session by its own
URL:

```
/nordic-wear-tshirt/dpp/demo-2026-t001/manifest.json
/volturra-pulse-2000/dpp/demo-2026-b001/manifest.json
/atelier-barro-vase/dpp/demo-2026-c001/snapshot.json
```

All are served by Vite from `/public/` after `npm run
seed` (the third is a lone snapshot, not a manifest).
Production hosts use the same shape but point at
wherever the manifest is published.

## Dev pages

Five HTML entry points live at the repo root for local
work; none ship in the npm package:

| Page | Loads | Use |
|---|---|---|
| `index.html` | `/src/main.ts` | The full `<transpareo-time-machine>` renderer. The default `npm run dev` page. |
| `verifier.html` | `/src/dpp-verifier.ts` | The standalone `<dpp-verifier>` widget (no passport chrome). Open `/verifier.html` while `npm run dev` is running. |
| `embed-example.html` | `dist-embed/embed.js` | Reference host page for the single-file embed build, and the canonical inline list of branding tokens (see "Theming"). Run `npm run build:embed` first; see the file's header comment. |
| `snapshot.html` | `/src/main.ts` | Single-snapshot mode: `src` points at one signed snapshot instead of a manifest, so the renderer shows that frozen version with no timeline/history. Open `/snapshot.html` while `npm run dev` is running. |
| `unsigned.html` | `/src/main.ts` | The unsigned single snapshot (the `atelier-barro-vase` fixture): no manifest, no proof, no branding. By default it renders with no verification chrome and no brandbar at all; add `show-verification-mark="true"` to the element to see the question-mark "Not verifiable" chip and its modal explanation. Open `/unsigned.html` while `npm run dev` is running. |

The embed delivery is also smoke-tested by
`tests/embed-smoke.spec.ts` (run under `npm run browser`): it
loads the built bundle and asserts it registers the custom
element and inlines its CSS.

The browser suite runs on all three engines and a release
gates on each: `npm run browser` drives Chromium,
`npm run browser:firefox` drives Gecko, and
`npm run browser:webkit` drives Safari's. WebKit's Linux
build links against `libicu74` and `libflite`, so on a distro
shipping neither, `npm run browser:webkit:docker` runs the
same suite inside the Playwright container image instead;
`npm run browser:firefox:docker` does the same for a checkout
that would rather not download Firefox.
`npm run a11y` remains as an alias for `npm run browser`.

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
    verify.ts                 eddsa-jcs-2022 verifier + aggregate verdict
    dispatch.ts               routes a proof to its cryptosuite verifier
    ecdsa-sd.ts               ecdsa-sd-2023 derived-proof verifier
    rdfc.ts                   JSON-LD to N-Quads (RDFC-1.0) for ecdsa-sd
    base64url.ts, cbor.ts, p256.ts   ecdsa-sd proof-value primitives
    did-web.ts, buffer.ts     shared verificationMethod + buffer helpers
  contexts/                   cached JSON-LD contexts (offline ecdsa-sd)
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

The `<dpp-verifier>` widget carries that chain in its own
shadow root, since a page that embeds the widget alone
loads no SPA stylesheet to declare `--font-sans` for it.
Every token it paints with resolves the same way: the
branding token first (`--font-family`, `--action-color`,
`--button-color-*`, `--background-color`), the renderer's
internal token second, its own neutral default last.

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

`npm run seed` writes every artefact the renderer fetches
into `public/`, so the dev server needs no upstream. To
develop against a live resolver instead, set
`DPP_ARCHIVE_ORIGIN=https://your-host` and `vite.config.ts`
proxies these paths to it. With the variable unset there is
no proxy at all:

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
  via Vite. All 40 bundled locales ship.

A property carrying several values (an intended-use list,
a certifications list) tags each value in every locale it
ships, and JSON-LD reads those values as an unordered set:
nothing in the data pairs one locale's second value with
another's. The renderer pairs them by the order the served
document lists them in, per locale, so a publisher emitting
a multi-value property has to keep that order stable across
locales. A locale shipping fewer values than the longest
one is left out of the pairing rather than risking a row
that reads "Ski alpin" in German and "Snowboarding" in
English; `tx()` then falls back to a locale that is there.
That order lives in the served document, not in the RDF:
ecdsa-sd canonicalization sorts quads, so anything that
rebuilds a snapshot from N-Quads loses the pairing.

The locale picker reads `availableLocales` from the
DPP and shows native names from `src/i18n/index.ts`.
Each row leads with what the viewer's locale calls the
language, via `Intl.DisplayNames`, capitalized for the
list context: that API answers in the mid-sentence form,
which most locales write lowercase (Italian "rumeno"),
where CLDR's list-and-menu rule titlecases the first
word. Those names are a hint layer, never a dependency:
an engine without `Intl.DisplayNames`, or one whose data
answers in a different language than the viewer's, leaves
every row reading as the native name this project ships.

An element states its language with `locale`: a tag pins
it, `inherit` follows the language surrounding the element,
and `auto` (the default) detects. `locale` outranks the
standard `lang` attribute, which is still read where no
`locale` is given.

Detection order: the user's stored pick when they made it
on a page naming the same locale the current one does,
then the host page's `lang` attribute when it names an
available locale, then that stored pick from any other
context, then `navigator.languages`, then the first
available locale. The standalone `<dpp-verifier>`
has no DPP locales to draw on, so it resolves `lang`
against the set of shipped label bundles instead.

> Label caveats (`byActor` rendering as colon-style in
> ja/ko/zh/ru/uk/tr; binary pluralisation in
> `cryptoProof.snapshotsVerified*` not handling Slavic
> plural classes) are documented in
> `src/i18n/data/README.md`.

> **Direction.** All 40 bundled locales are
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
tests, builds, runs the browser suite against a fresh seed,
and
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
