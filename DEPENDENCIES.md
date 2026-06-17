# Dependencies

This renderer ships with **zero runtime npm dependencies**.
`package.json` declares no `dependencies` block: nothing in
`dependencies` is pulled into the browser bundle. Everything
the Transpareo Time Machine needs at runtime is either written
in this repo or provided by the platform (WebCrypto, the DOM,
`fetch`).

The one piece of third-party code that reaches end users is
vendored in-tree, not installed from npm (see below). The
icon sprite additionally carries third-party artwork
(font-glyph conversions; per-set attribution in
THIRD-PARTY-LICENSES.md). Every other package is a build-
or test-time tool listed under `devDependencies`.

Each entry below states why the dependency exists and what
removing it would cost. If a dependency cannot answer "what
breaks if this is gone", it should not be here.

## Vendored runtime code (ships to users)

### noble-ed25519 (`src/crypto/ed25519.ts`)

- **What:** noble-ed25519 v3.1.0, copied verbatim from the
  npm package (paulmillr/noble-ed25519). Kept byte-for-byte
  so it stays auditable against upstream.
- **License:** MIT, *not* GPL-3.0 like the rest of this
  repo. The file header keeps the `/*! ... */` banner, the
  build re-applies it to the emitted chunk, and the full
  license text ships in THIRD-PARTY-LICENSES.md.
- **Why vendored, not installed:** it is the pure-JS Ed25519
  verify fallback for browsers without native WebCrypto
  Ed25519. It is lazily imported, so engines with native
  support never download it. Vendoring keeps the supply chain
  inert (no install-time fetch of crypto code) and the audit
  surface fixed to one reviewed version.
- **Cost of removal:** signature verification would fail on
  browsers lacking native Ed25519, silently downgrading the
  passport's authenticity guarantees.

## Specifications implemented in-house

Two pieces of the proof flow are original implementations
of public specifications, not imported code:

- `src/crypto/multibase.ts` implements multibase base58btc
  (the `z`-prefix variant of the IETF multiformats draft,
  Bitcoin alphabet, no checksum), used for Multikey public
  keys and `proofValue` strings.
- `src/crypto/jcs.ts` implements RFC 8785 (JSON
  Canonicalization Scheme), the canonical form the
  signatures are computed over.

## Build & bundling

### vite

- **What:** dev server and production bundler.
- **Used by:** `npm run dev`, `npm run build`,
  `npm run build:embed`, `npm run preview`.
- **Cost of removal:** no bundle output; the lib, verifier,
  and embed entry points could not be produced.

### sass

- **What:** Dart Sass compiler for the SCSS in `src/styles/`.
- **Used by:** Vite's SCSS pipeline at build time.
- **Cost of removal:** component styles would not compile.

### typescript

- **What:** the compiler behind `npm run check` (three
  `tsc` project configs) and the type layer the bundle is
  authored in.
- **Cost of removal:** no type-check gate; build authored in
  untyped JS.

### tsx

- **What:** TypeScript script runner used outside the Vite
  build.
- **Used by:** the seed pipeline (`scripts/seed/*`), fixture
  validation (`check:fixtures`), SRI emission (`emit:sri`),
  and the bundle-size gate (`check:bundle-size`).
- **Cost of removal:** the build/CI helper scripts could not
  run without a separate transpile step.

## Fixtures & data

### zod

- **What:** schema validation for `fixtures/*.yml`.
- **Used by:** `scripts/seed/schema.ts`,
  `scripts/seed/validate.ts`, `scripts/seed/generate.ts`
  (the `check:fixtures` gate).
- **Cost of removal:** fixture schema regressions would only
  surface as downstream build or runtime failures, not at the
  validation gate.

### yaml

- **What:** parses the human-authored `fixtures/*.yml` into
  the objects the seed pipeline validates and emits.
- **Used by:** `scripts/seed/validate.ts`,
  `scripts/seed/generate.ts`.
- **Cost of removal:** fixtures could not be read; the seed
  step would not run.

## Linting

### eslint, @eslint/js, typescript-eslint

- **What:** the lint stack behind `npm run lint` (`eslint .`).
  `@eslint/js` and `typescript-eslint` provide the JS and
  TypeScript rule sets and the flat-config presets.
- **Cost of removal:** no lint gate; style and correctness
  rules would go unenforced in CI.

## Testing

### vitest

- **What:** the unit/integration test runner.
- **Used by:** `npm test` and `npm run test:watch`; covers
  everything under `tests/` except `a11y.spec.ts`.
- **Cost of removal:** the bulk of the suite (crypto, verify,
  signals, parsing, URL safety) would not run.

### happy-dom

- **What:** a lightweight DOM implementation for tests.
- **Used by:** DOM-dependent unit specs that opt in per
  file via `// @vitest-environment happy-dom` (the
  `html\`\`` template-engine spec); everything else keeps
  the plain `node` environment.
- **Cost of removal:** the reactive template engine, the
  core of every declarative component, would only be
  exercised indirectly through Playwright.

### @playwright/test

- **What:** the browser-driving test framework.
- **Used by:** the WCAG gate `tests/a11y.spec.ts` via
  `npm run a11y` (release-only; see `ci.yml` for why it is
  kept out of per-PR CI).
- **Cost of removal:** no rendered Transpareo Time Machine
  test harness.

### @axe-core/playwright

- **What:** axe-core bound to the Playwright page, used to
  assert no WCAG 2.2 AA violations on the rendered demo.
- **Used by:** `tests/a11y.spec.ts`.
- **Cost of removal:** the accessibility gate would lose its
  automated check.

## Types

### @types/node

- **What:** Node type definitions for the build/seed scripts
  and config files that run under Node, not the browser.
- **Cost of removal:** `tsc -p tsconfig.node.json` would not
  type-check the script and config layer.
