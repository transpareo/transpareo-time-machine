# Changelog

All notable changes to this project are documented in
this file.

The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The type scale carries its own sizes. Every size the
  renderer's stylesheets name is a token the SPA stylesheet
  declares, so a shadow root that stylesheet never reaches
  had no size at all to apply and its text took whatever the
  surrounding page inherited down: in the standalone verifier
  widget the form and the proof rows all rendered at the host
  page's body size. Each step now falls back to the value the
  SPA sets it to, and to the publisher's own token first
  where the SPA derives one, so the scale holds wherever the
  stylesheets land.

### Fixed

- A republished version URL no longer renders from the
  browser's HTTP cache under a verification failure. A
  publisher may re-emit a version under the URL it already
  used, so a returning visitor's browser can replay the
  previous publish: those bytes render, but they no longer
  hash to the revalidated manifest's claim for that version
  and no longer verify if the signing key changed with them.
  The renderer now checks a version's bytes against the
  manifest's `hashValue` before it accepts them, and re-reads
  a rejected version - and the priors its chain walk needs -
  past the HTTP cache before taking a second, final verdict.
  A failed badge therefore always describes what the origin
  serves now, never something the browser kept. A judging
  pass re-reads each version at most once; the proof modal's
  re-verify button asks the origin again and re-runs the
  manifest signature check, so a transient key-host failure
  clears on the click instead of outliving it.
- The events sidecar is revalidated on boot like the manifest
  it is named from. It is one mutable document under a stable
  URL that grows with every event a publisher records, so a
  replayed copy left the timeline showing an earlier state of
  the passport's history.
- The standalone verifier widget revalidates every artefact it
  reads. It answers what the origin serves right now, so a
  verdict taken from a copy the browser kept could describe an
  earlier publish while naming the current URL.

## [2.9.0] - 2026-08-12

### Added

- `locale` on either element states which language to render
  in, without overloading the standard `lang` attribute a
  shell may template everywhere for assistive tech and search
  engines. A tag pins (`locale="de"`, region stripped),
  `inherit` follows the language surrounding the element, and
  `auto` detects from the visitor's browser, which is what an
  absent attribute has always meant. Both keywords match in
  any casing. `locale` outranks `lang`,
  which is still read where no `locale` is given, so
  `locale="auto"` is how a page that sets `lang` everywhere
  keeps detection for this one element. In verifier mode the
  renderer hands the mounted widget an already-resolved
  locale, since `inherit` asks about the page around the
  element and the widget cannot see out of its shadow root.

### Fixed

- The sign-in hand-off tells the authorising system which
  language to answer in. The button behind a 401 on the
  private-properties endpoint sent only a return target, so a
  visitor reading a German passport could land on an English
  login page. It now carries the active locale as `locale`,
  the name this platform uses for it elsewhere. A login URL
  that already names a locale is left untouched, whichever
  spelling it uses, which is how a backend opts out.

## [2.8.1] - 2026-08-12

### Fixed

- An `ecdsa-sd-2023` passport now reaches an authentic
  verdict on a host page that pins keys. The derived-proof
  path threw away the Multikey each proof's
  `verificationMethod` resolved to, so no ecdsa-sd entry
  could ever match `pinned-platform-key` /
  `pinned-issuer-key`. Both pin gates failed and every
  version was stored as failed - the chip read "Verification
  failed" and the proof modal "Signature mismatch" - while
  the proofs themselves, the manifest signature and the
  whole version chain had verified. The resolved key now
  rides on each proof result, is matched against both pin
  sets (only for a proof that actually verified), and counts
  authorities the way the `eddsa-jcs-2022` path does.
- The Issuer and platform columns of the per-version
  verdicts table fill in for `ecdsa-sd-2023` versions, and
  the proof rows are named and ordered issuer-first.
  Authority grouping matched key-path URLs only, which is
  how an eddsa-jcs proof set names its keys; an ecdsa-sd
  credential names a `did:web` method per authority. Those
  are now matched against the DIDs the snapshot declares,
  and where that leaves one of two groups unnamed - an
  issuer whose signing key lives under a `did:web` host of
  its own, which the passport does not declare - the group
  opposite an identified authority takes the remaining
  party, since a DPP is signed by exactly two. Three or
  more groups, or none identified, stay unattributed rather
  than guessed.
- The per-version verdicts table tells "not checked yet"
  apart from "does not apply". A version whose check has not
  run reads as the pending ellipsis in all three columns
  instead of borrowing the dash that v1's chain cell
  legitimately carries, and a check that ran and failed
  always renders the red X. That includes a failed version
  with nothing attributable in it - a verify that threw, a
  snapshot carrying no proof, a cryptosuite this build
  cannot read, proofs under keys nothing identifies - where
  both authority columns used to show the dash that reads as
  "nothing to check here". The dash stays where it belongs:
  a credential that carries one authority's proof only.
- A proof group neither rule can attribute keeps a name in
  the proof modal ("Authority", as the widget already showed)
  instead of rendering a nameless row.
- The standalone `<dpp-verifier>` widget verifies
  `ecdsa-sd-2023` passports. It called the `eddsa-jcs-2022`
  verifier directly, with no cryptosuite dispatch, so every
  derived proof failed on "bad signature encoding: not a
  z-prefixed multibase string" (an ecdsa-sd `proofValue` is
  base64url CBOR, not base58) and a valid passport read as
  "Only 0 of 2 entries verified". Both surfaces now go
  through one entry point that takes its pin sets as
  arguments, so the widget's own `pinned-platform-key` set
  applies where it previously would have inherited the
  renderer's element config.
- The widget's verdict orbs show their glyph again. It
  renders into its own shadow root, which a `<use href="#…">`
  cannot escape, and only the SPA host installed the bundled
  functional sprite - so the orbs came out as empty circles,
  standalone and nested alike. The widget installs the sprite
  into its own root now.
- Both surfaces attribute proofs to the issuer and the
  platform by one shared rule, weighing a matching pin, a
  key-path URL, a declared DID and the two-party structure
  in that order. The widget had a second rule for a pinning
  host page: every entry that matched no pin was the
  issuer's, which put a foreign passport's platform proofs,
  and a failed platform proof of its own, on the issuer's
  card. A pin now only strengthens the attribution, never
  replaces it.
- An embedding page's `lang` decides the widget's language.
  A locale the visitor had once picked in the passport
  widget is kept in `localStorage`, and that outranked
  `lang`, so a page rendering `<dpp-verifier lang="en">` came
  up in whatever language that visitor last chose and stayed
  there. The host `lang` now wins over a pick made anywhere
  else, whenever it names an available locale.
  A pick is stamped with the `lang` it was made under, so the
  one case it does not outrank is a choice the visitor made
  right there, on a page carrying this same `lang`: an
  in-page language picker still remembers, and an embedder
  that switches its own `lang` still overrides a choice from
  the version it served before. On a page that sets no
  `lang` the stored pick decides as it always did.
- `lang` reaches the widget in verifier mode. The renderer
  mounts a `<dpp-verifier>` in its own shadow root there, and
  the widget reads `lang` off its own element, so a
  `<transpareo-time-machine lang="de" verifier>` came up in
  the browser's language: the nested element found no `lang`
  of its own and cleared the one the renderer had set. The
  attribute now travels with the mounted widget, like the
  pinned platform keys already did.
- Language names in the footer picker start with a capital
  in every locale. The leading name comes from
  `Intl.DisplayNames`, which answers in the form a sentence
  would use, and 26 of the 40 bundled locales write language
  names lowercase there - Italian "rumeno", French
  "allemand", Russian "болгарский" - so those rows read as
  mid-sentence fragments beside their own native name
  ("rumeno" next to "Română"). CLDR keeps a separate rule for
  a list or menu (titlecase-firstword) that the Intl API has
  no parameter for; the picker applies it now, to the first
  word only and through the viewer's locale. Chinese,
  Japanese, Korean, Hindi and Bengali rows are unchanged,
  their scripts having no case. Sorting and the type-ahead
  filter are unaffected: both already ignore case.
- A locale code or property key that names an `Object`
  method no longer reaches the UI as a function. Both lookup
  tables the renderer keys by untrusted data - the native
  locale names and the publisher's icon map - are plain
  objects, so `"toString"` resolved off the prototype: the
  language picker threw where it called a string method on
  the result, taking the footer down with it, and the icon
  map would have spliced a function's source into a
  `<use href>`. Both read own properties only now.
- A picker row's right-hand hint is a real native name or
  nothing. It fell back to the uppercased locale code, so a
  DPP declaring a locale outside the 40 we ship names for
  rendered "PT-BR" next to "Brazilian Portuguese", which
  reads as data leaking into the UI rather than as a
  language.
- Language names the platform answers in the wrong language
  are ignored. `Intl.DisplayNames` does not fail for a locale
  an engine carries no data for: it resolves to a fallback
  and answers confidently in that instead, so a viewer whose
  language the browser lacks would have read English names
  beside correct native ones, with nothing downstream able to
  tell. The resolved locale is compared against the requested
  one now, and a mismatch leaves the row with the native name
  this project ships itself.

## [2.8.0] - 2026-08-09

### Fixed

- The page numbers in the gallery and lightbox pagination
  circles sit 1px lower, optically centred instead of
  geometrically centred a touch high.

### Added

- Every artefact fetch sends
  `Accept: application/ld+json, application/json`, so `src`
  can be the passport URL itself on a publisher that serves
  the HTML page and the JSON dataset from one URL via HTTP
  content negotiation (the EN 18216 baseline). The dataset
  such a URL returns is a single snapshot, rendered in the
  existing single-snapshot mode. The README now opens with
  that standards-mandated URL, explains that the full
  timeline needs the manifest (the version index the
  standardised APIs do not provide), and documents the
  manifest structure field by field.

## [2.7.0] - 2026-08-08

### Added

- The footer language picker now leads each row with what the
  viewer's current locale calls the language ("German" while
  browsing in English) and keeps the native name ("Deutsch")
  as a muted italic hint on the row's right edge; where both
  names coincide the native name stands alone. Rows sort by
  the leading name and re-sort on every language switch, and
  the type-ahead filter matches either name, so "deutsch"
  still finds German while browsing in English.

## [2.6.0] - 2026-07-31

### Added

- `<transpareo-time-machine>` exposes a read-only `state`
  property carrying the same detail as the
  `transpareo-time-machine:state` event, or `null` before the
  manifest has loaded. The event has no replay, so an
  integration script that attached its listener after the
  first dispatch previously stayed blind until the visitor
  scrubbed or switched locale. It is a live read, so it also
  answers "is the visitor on the current version right now"
  outside a listener.

### Fixed

- Modal overlays are now the scroll container: on wide and
  tablet viewports a swipe or wheel anywhere over the
  overlay, the gutters beside the dialog included, scrolls
  the dialog instead of dead-ending, and
  `overscroll-behavior: contain` keeps the locked page
  behind from moving. The dialog no longer caps at 90vh
  with an inner scrolling body; it grows with its content
  while the header stays sticky at the top, resting with
  the overlay gap and pinning flush once content scrolls
  under it. Applies to the proof, event, and library
  modals and to integration modals opened via
  `tm.openModal(...)`. While a modal is open, the page
  hands its reserved scrollbar slot to the overlay, so a
  single scrollbar shows at the window edge and the page
  behind keeps its width.
- The integration-hook docs describe the `additional` slot
  and the `:state` event accurately for more than one
  integration. Multiple slotted children are supported and
  project in source order; the event re-dispatches on every
  timeline step rather than only on a version change; and
  the example dedupes on a marker the integration owns
  instead of on the slot name, which two integrations would
  have raced on. No code change.

## [2.5.2] - 2026-07-25

### Fixed

- Dismissing a modal no longer closes the DPP history behind
  it. An open modal keeps one extra history entry so the
  platform Back gesture closes the dialog; popping that entry
  on Escape / X / Back landed on the same URL, which the hash
  sync read as a navigation to "no event focused" and
  collapsed the timeline. Same-hash history events are now
  ignored.

## [2.5.1] - 2026-07-24

### Changed

- The version-checks subtitle breaks the key count down per
  authority and names the issuer: "verified against 5 keys in
  your browser, 3 from the issuer (Nordic Wear) and 2 from
  Transpareo." The chain block (cryptosuite line and authority
  rows) no longer double-indents; it aligns with the subtitle.

### Fixed

- The ecdsa-sd version chain no longer reports every version as
  broken. The seed stamped each manifest `hashValue` and
  `priorVersionHash` with the flat JCS body hash, but the
  verifier recomputes an ecdsa-sd snapshot's chain hash over
  its RDFC canonical statements, so the two never matched on a
  selective-disclosure passport. The chain hash now lives in
  one module (`src/crypto/chain-hash.ts`) shared by the seed,
  the SPA chain walk, and the standalone verifier widget, so
  producer and consumer cannot drift apart. The widget also now
  reads `priorVersionHash` from `credentialSubject` for
  VC-shaped snapshots.

## [2.5.0] - 2026-07-24

### Added

- ecdsa-sd-2023 selective-disclosure verification. The SPA now
  verifies W3C ecdsa-sd-2023 selective-disclosure proofs
  (per-statement P-256) alongside the existing whole-document
  eddsa-jcs-2022 Ed25519 path, chosen by the proof's
  cryptosuite. An ecdsa-sd snapshot carries two proofs, the
  issuer's and the platform's counter-signature, each verified
  against the key its own `verificationMethod` resolves to, and
  the snapshot is authentic only when every proof verifies. The
  proof modal shows one authority row and key chip per proof
  plus the active snapshot's cryptosuite. The new path adds no
  dependencies (multibase base64url, a verify-only CBOR decoder,
  P-256 over WebCrypto, and a scoped RDFC-1.0 canonicalizer) and
  resolves the VC and transpareo JSON-LD contexts offline. A
  history that spans both cryptosuites verifies its version
  chain end to end, hashing each link in the prior version's
  own format.
- Login-gated private properties. A passport version can carry
  private rows withheld from the public snapshot and gated
  behind its `privateProperties` endpoint. The "Sign in for
  additional product data" affordance hands off to the
  authorising system's own login through a full-page redirect,
  the eIDAS / SSO / wallet flows the SPA cannot render itself,
  and merges the rows on the authenticated reload without ever
  touching credentials. The endpoint's derived credential is
  cryptographically verified, failing closed, before any
  private row renders.
- The browser Back button (and the mobile swipe-back gesture)
  now closes an open modal instead of navigating the host page
  away. While a dialog is open it keeps one extra history entry
  as a dismissal breakpoint; Escape, click-outside, and the
  close button pop that entry back off so the history stack
  stays balanced. Applies to every modal (proof, event,
  library, lightbox, and the public `openModal` API) and layers
  cleanly over the timeline's own hash navigation.

### Changed

- Numeric scalars, substance shares, and the weight quantity
  are read from the signed `{@value, @type}` typed-literal form
  and rendered by their explicit lexical value, no longer
  relying on hash-key order.
- The EPCIS events document's `@context` is now the EPCIS 2.0
  context and the transpareo vocab only, with the transpareo
  prefix declared inline. JSON-LD expansion and EPCIS XML
  conversion no longer depend on fetching a remote context or
  trip over the DPP contexts' redefined `@protected` terms, and
  the demo fixtures use valid 14-digit GS1 Digital Link GTINs.
- The proof modal labels the issuer generically as "Issuer", in
  both the per-version verdicts table header and the
  version-checks authority rows, instead of the economic
  operator's own name, which can run long; the full name is
  spelled out once in the version-checks intro. When a snapshot
  carries one issuer key and one platform key (the ecdsa-sd
  two-proof shape) that intro names both owners. New label key
  `cryptoProof.versionsCheck.summary.twoAuthorities` across all
  40 locales.

### Removed

- The in-SPA credential form is gone (the auth modal, its
  `X-Auth-Fields` challenge, and token handling); the
  private-properties redirect hand-off replaces it.

### Fixed

- The proof modal no longer overflows horizontally on narrow
  phones: the per-version verdicts table scrolls inside its own
  strip when it outgrows the viewport, and modal bodies clip
  sideways overflow instead of growing a second scrollbar.
- did:web key resolution shares the 15s fetch timeout of every
  other verify-path fetch, so a hung key host fails the check
  instead of spinning the verification chip forever.
- The verification chip's label sits on the orb's optical
  centre line.

## [2.4.0] - 2026-07-02

### Changed

- The EPCIS events document's platform signature is read from
  `transpareo:signature`; namespacing the key lets the events
  file validate against the EPCIS 2.0 schema, whose document
  `propertyNames` reject a bare `signature`. The old bare
  `signature` key is still accepted for older feeds.
- An event's raw view, Copy, and Download emit a full EPCIS
  2.0 `EPCISDocument` (the event wrapped in the served file's
  envelope) instead of a bare `ObjectEvent`, so the output
  drops straight into EPCIS tooling.

## [2.3.0] - 2026-07-02

### Changed

- The EPCIS event-details view renders `bizStep` and
  `disposition` as the bare CBV local term (`shipping`,
  `in_progress`) emitted by the events feed, spacing
  underscores for display.

## [2.2.0] - 2026-06-28

### Added

- Vietnamese (`vi`) UI label bundle, bringing the shipped
  locale count to 40. The picker lists it as "Tiếng Việt"
  whenever a DPP's `availableLocales` includes `vi`, and the
  standalone verifier honors `lang="vi"`.

### Fixed

- The language picker now renders native names for `bs`, `is`,
  `mk`, `sq`, and `sr` instead of an uppercased locale code.

## [2.1.0] - 2026-06-25

### Added

- Both `<transpareo-time-machine>` and `<dpp-verifier>` now
  honor the standard HTML `lang` attribute (e.g. `lang="de"`,
  region stripped) to pin the UI locale. It outranks the
  browser preference but not the user's stored pick, and only
  applies for locales that have a shipped label bundle. The
  standalone verifier benefits most: with no DPP
  `availableLocales` to detect from, it previously stayed on
  English regardless of the embedding page.

## [2.0.1] - 2026-06-23

### Fixed

- A draft preview (an unsigned, not-yet-published snapshot) no
  longer leaves the verification chip spinning on "Verifying"
  forever. A draft has nothing to verify, so the chip now
  reads a quiet "Not yet published" instead of a perpetual
  spinner or a misleading failure.
- Material composition rows whose substances carry no
  percentage no longer render a column of "0%" and an empty
  donut: with no quantities the breakdown shows the substance
  names (and ratings) alone, omitting the numbers and the
  ring.

## [2.0.0] - 2026-06-20

### Changed

- **BREAKING:** proof verification migrated to the standard
  W3C **eddsa-jcs-2022** Data Integrity cryptosuite, replacing
  the reduced `eddsa-jcs-sha256` profile. Each proof is now
  signed independently over `SHA-256(JCS(proofConfig)) ||
  SHA-256(JCS(document))` (proof config first), so any
  conformant Data Integrity verifier interoperates. The
  "Verified" verdict counts authorities by resolved key
  rather than by shared signature. Lockstep with the
  publisher backend: a renderer on this version rejects
  snapshots still signed with the old profile, so the backend
  must emit eddsa-jcs-2022 proofs together with this release.
- **BREAKING:** `SnapshotProof.type`, `cryptosuite`,
  `created`, and `proofPurpose` are now required (the suite
  signs them, so every entry carries them).

### Fixed

- The page stays legible when a publisher's `branding.css` is
  absent: neutral theme-token defaults live in a low-priority
  cascade layer that a host's `branding.css` still overrides.
- Full-state timeline connector lines no longer cross; the
  near-strip rails are ordered by span so a longer run sits
  above the shorter runs it spans.
