# Security policy

The Transpareo Time Machine ships cryptographic
verification code that runs in untrusted browsers and
reports a verification verdict to the visitor through
the on-card verification chip. Bugs that let a forged
or tampered DPP snapshot verify, or that downgrade the
aggregate verdict's strength, are treated as security
vulnerabilities and handled under this policy.

## Reporting

Please email security findings to
**security@transpareo.com**.

Do **not** open a public GitHub issue or PR for
security-relevant problems. A public report gives
attackers a head start before downstream consumers can
upgrade.

When you report, include:

- The version (`package.json` `version`, or the git
  commit hash if you tested off `master`).
- A minimal reproduction. For the verifier specifically,
  a JSON snapshot + proof set + resolution-doc fixtures
  that demonstrates the issue is ideal.
- Your assessment of severity and exploit conditions.
- Whether you want to be credited in the eventual
  advisory (and under what name).

We acknowledge new reports within **3 business days**.

## Disclosure timeline

We coordinate disclosure with the reporter. Default
timeline:

- T+0: report received, triage starts.
- T+3 business days: acknowledgement, severity
  assessment shared with the reporter.
- T+30 days: fix landed on `master`, pre-release
  bundle available for testing.
- T+45 days: patched release published to npm, git tag
  pushed, GitHub Security Advisory drafted.
- T+90 days (max): public disclosure, even if the fix
  is still in progress. Reporters can request earlier
  disclosure once their own consumers have upgraded.

Critical vulnerabilities (signature bypass, RCE in the
seed pipeline, etc.) may compress this timeline.

## Supported versions

| Version | Status |
| ------- | ------ |
| 1.x     | Supported. Security fixes will be backported. |
| < 1.0   | Pre-release. Not supported. |

A version is "supported" while it is the current
`major` line on npm. Once 2.0 ships, 1.x receives
security fixes for at least 6 months.

## In scope

- The in-browser signature verifier (`src/crypto/`)
  and its consumers (`src/actions.ts`,
  `src/components/dpp-verification-modal.ts`,
  `src/components/dpp-verifier.ts`).
- The aggregate-verdict rule (default
  any-issuer-and-any-platform; strict all-entries) and
  its inputs (proof grouping, key pinning).
- The seed-pipeline signing flow
  (`scripts/seed/signing.ts`, `scripts/seed/emit-artefacts.ts`)
  insofar as it produces artefacts the verifier
  consumes.
- Supply-chain attacks on the published npm tarball
  (the contents of `dist/`).

## Out of scope

- The host page that embeds
  `<transpareo-time-machine>`. Issuers are responsible
  for serving the bundle from a host they control and
  for the integrity of the manifest URL they point the
  element at.
- The freshness or accuracy of demo fixture data under
  `fixtures/`, `public/`. The seeded artefacts are
  examples, not production identities.
- Third-party CDNs (unpkg, jsdelivr). Issues reaching
  those services should be reported to them directly.
- Reports that consist solely of unauthenticated static
  analysis output (e.g. CodeQL, Semgrep) without a
  reproducible trigger.

## Known limitations

Documented, accepted gaps. Reports about these are
welcome only if they demonstrate impact beyond what is
described here.

- **No freshness binding (rollback window).** The
  manifest signature proves the version list is
  authentic and the `priorVersionHash` chain proves its
  continuity, but nothing binds the served manifest to
  the present: an attacker who controls the data origin
  can serve an older, genuinely-signed manifest and
  snapshot set, and the verdict stays green. The wire
  format already carries `signedAt`, `registeredAt`,
  and `registrationProof` for a future max-age or
  registry cross-check; the renderer does not evaluate
  them yet.
- **Unpinned verdicts are advisory.** Without
  `pinned-platform-key`, the verdict proves internal
  consistency of the served artefacts (any two
  authorities), not their origin; a data origin that
  fabricates both keypairs satisfies the rule. Pinning
  the platform key on a trusted surface is the
  additional security layer that makes the verdict
  robust against the data origin. The standalone
  `<dpp-verifier>` additionally reports an identity
  tier: a named "Verified by {platform}" banner requires
  either the pin or signing keys resolving from the
  domain the manifest's `platform.did` declares;
  otherwise it reports "signer identity unconfirmed"
  rather than echoing a claimed name.
- **Component-library JSONs are unsigned.** The library
  detail a composition row's modal fetches lazily is
  supplementary content, deliberately outside the
  snapshot signature so issuers can fix typos without
  re-signing history. The modal makes no verification
  claim about it; the signed, verified data is the
  snapshot content itself.

## Acknowledgements

We publish credited acknowledgements with each
advisory unless the reporter requests anonymity.
