# UI labels

One JSON file per locale. The keys are stable; values
are translations. `en.json` is the source of truth,
keys are added there first, then propagated to the
other 38 files.

`labels.ts` lazy-loads each locale through Vite's
`import.meta.glob`, so only the active locale's bundle
ships to the user. English is bundled synchronously
as the fallback for missing keys / failed loads.

## Translation status

Ambiguous single-word labels (event types, statuses)
carry the domain sense - e.g. "Recall" as a product
recall and "Actor" as the acting party, not a performer.

Every non-English file mirrors the full key set in
`en.json`; there are no keys silently falling back to
English at runtime.

## Known caveats

### `byActor` style differs by locale

The English template renders `by Anna Schmidt`,
preposition + name. The European Latin-script
translations all chose preposition equivalents
(`von`, `par`, `por`, `di`, `door`, `av`, `af`, …) so
the output reads naturally:

- de: `von Anna Schmidt`
- fr: `par Anna Schmidt`

The translations for `ja`, `ko`, `zh`, `ru`, `uk`, and
`tr` chose label-style with a colon (`担当: …` /
`автор: …` / `ekleyen: …`) rather than a preposition.
Output:

- ja: `担当: Anna Schmidt`
- ru: `автор: Anna Schmidt`

Functional but stylistically inconsistent; refine if a
different idiom reads better.

### Pluralisation is binary

`cryptoProof.snapshotsVerified` and
`cryptoProof.snapshotsVerifiedPlural` only carry two
forms (English's singular vs. plural rule). Languages
with richer plural rules use only those two forms
today:

- Russian: real form set is `1 / 2-4 / 5+` (3 forms)
- Polish: similar 3 forms
- Arabic: 6 forms (not currently a supported locale,
  but worth noting for future)

For now the SPA falls back to the plural form when
`count !== 1`. To do this properly, switch the
renderer to `Intl.PluralRules` and add the missing
form variants per locale (`cryptoProof.snapshotsVerifiedFew`,
`cryptoProof.snapshotsVerifiedMany`, etc.).

### Brand name

`Transpareo` is a brand name and is never translated,
it appears verbatim in every locale file. Translators
should keep the casing intact and not transliterate
into local scripts.

### Regulatory enums

The `eventType.*` and `status.*` keys map to EU DPP
regulatory states. Where official translations exist
(German Rückruf, French rappel, etc.), the file uses
those.

## Adding a new key

1. Add the key + English value to `en.json`.
2. Update `Labels` consumers in `src/components/` to
   use `t(i18n.labels, key)`.
3. Add the translated value to every other locale file,
   reusing each catalog's existing vocabulary for shared
   terms (grep the neighbouring keys before wording a new
   one). The test suite enforces key and placeholder
   parity across all locales, so a missing or mistyped
   entry fails `npm test`.
4. Run `npm run check` to type-check the updated consumers.

## Adding a new locale

1. Drop a new `<code>.json` mirroring `en.json`'s
   key set.
2. Add the native name to `NATIVE_NAMES` in
   `src/i18n/index.ts`.
3. The picker shows it automatically when the DPP's
   `availableLocales` lists the code.
