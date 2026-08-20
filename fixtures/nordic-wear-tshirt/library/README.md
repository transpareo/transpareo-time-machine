# Component library fixtures

One JSON file per component, versioned by path
(`<component>/v<n>.json`). A snapshot's composition entry
points at one through its `libraryRef`, and the renderer
fetches it lazily when the reader opens that row. The files
are served from `public/` after `npm run seed`; nothing
about them is signed and nothing verifies them.

A snapshot's `libraryRef` is resolved against the manifest
URL and fetched as-is, whatever shape it names. These
fixtures use one shape out of several that work: a
relative path beside the manifest, pinned to a version. A
publisher may equally emit an absolute URL on its own
asset host, or point at a mutable entry with no version in
the path that is rewritten whenever the component is
edited. `tests/library-ref-resolve.spec.ts` pins all of
them, because a fixture showing one shape reads as though
it were the shape.

The renderer handles them all and proves none: the ref
sits outside the proof chain and carries no content hash,
so a recycled version and an ordinary edit both read as
the original. An absolute ref also means opening a
passport can fetch from a host the reader never chose,
which is why the fetch omits credentials and every value
reaches the DOM as text.

What that puts at risk is the editorial detail in the
modal, not the claims. A composition row signs its own
name, country, rating, value and unit inside the
credential; the library entry adds the rows shown beneath
them.

## Editing these during dev

`npm run seed` deletes and recreates the published
`component/` tree, which leaves a running `npm run dev`
holding a stale handle to the old directory: the passport
keeps working, the component modal quietly shows its frozen
lead with no rows below, and nothing logs an error. Restart
the dev server after a re-seed. This file is not published,
only the `.json` entries are.

## Shape

These mirror a published entry: the `@context` array
(schema.org first, the component-library vocabulary second,
so the second wins the overlapping terms), `@type`, and
then `id`, `name`, `permalink`, `points`, `properties`.
`references` is dropped entirely rather than emitted empty
when a component has no links.

`permalink` is not a second fact: a published entry writes
the same string into `id` and `permalink`, so a file where
the two differ is a shape the publisher never writes.

`points` and `rating` are one fact, not two. `points` is a
signed integer summed from the component's properties, some
of which contribute negative points, and `rating` is
derived from it by bucketing against the scale edges -30,
-10, 10, 30. Changing one without the other produces an
entry no publisher could emit. The values here sit
mid-bucket so none of them depends on whether an edge is
inclusive, and each pair matches the rated characteristics
in the same file.

## What these deliberately omit

A published entry is signed, and carries `version`,
`publishedAt` and `proof` stamped together at signing time.
There is no path that produces one with `version` but no
proof.

These fixtures keep `version` and omit `publishedAt` and
`proof`, because they are unsigned demo data. A fabricated
proof block would be worse than an absent one: the failure
mode is somebody verifying it, finding it invalid, and
having to work out whether the signing is broken or the
fixture is decorative.

So the divergence is deliberate. A consumer written against
these files should expect the two missing keys on anything
real, and should not expect these to verify.
