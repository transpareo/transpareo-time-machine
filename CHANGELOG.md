# Changelog

All notable changes to this project are documented in
this file.

The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Proof verification migrated to the standard W3C
  **eddsa-jcs-2022** Data Integrity cryptosuite, replacing
  the reduced `eddsa-jcs-sha256` profile. Each proof is now
  signed independently over `SHA-256(JCS(proofConfig)) ||
  SHA-256(JCS(document))` (proof config first), so any
  conformant Data Integrity verifier interoperates. The
  "Verified" verdict counts authorities by resolved key
  rather than by shared signature. Lockstep with the
  publisher backend: a renderer on this version rejects
  snapshots still signed with the old profile, so the
  backend must emit eddsa-jcs-2022 proofs together with this
  release.
- `SnapshotProof.type`, `cryptosuite`, `created`, and
  `proofPurpose` are now required (the suite signs them, so
  every entry carries them).
