# Contributing

External contributions are welcome. A few notes that
will save round-trips on review:

- Open an issue before any non-trivial change so we
  can agree on direction; small fixes can land as a
  PR directly.
- Run `npm run check`, `npm run check:fixtures`, and
  `npm test` before pushing. `check` type-checks the
  SPA, the seed scripts, and the test sources.
  `check:fixtures` parses every `fixtures/*.yml`
  through the Zod schema without hitting the network.
  `test` runs Vitest over the crypto layer
  (JCS canonicalization, multibase, eddsa-jcs-sha256
  verifier) and the reactive runtime. CI runs all
  three on every push and PR.
- Keep commit titles under 80 characters and write
  in the imperative ("Fix X", "Add Y"), see
  `git log --oneline` for the in-repo style.
- Translation improvements for any of the locale files
  in `src/i18n/data/` are especially welcome.
- New features go through a fixture: see
  `fixtures/*.yml` for the shape and `scripts/seed/`
  for the YAML to signed-JSON artefact pipeline.
- Style: `src/` is ASI (no statement-ending
  semicolons); `scripts/` and root-level configs use
  explicit semicolons. Follow the prevailing style of
  the file you are editing rather than reformatting.

By contributing you agree to license your changes
under [GPL-3.0-or-later](LICENSE), matching the rest
of the codebase.
