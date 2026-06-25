# Changelog

All notable changes to this project are documented in
this file.

The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
