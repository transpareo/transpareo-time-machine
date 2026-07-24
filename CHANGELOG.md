# Changelog

All notable changes to this project are documented in
this file.

The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
