import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Embed build, the script-tag delivery shape.
//
// vite.config.ts emits the lib bundle that npm /
// bundler consumers integrate: separate
// transpareo-time-machine.{js,css} files so their own
// build pipeline can fingerprint, dedupe, and order the
// stylesheet alongside their other assets. That's the
// right contract for a bundler, the wrong contract for
// someone pasting a tag into a CMS - they would have to
// remember a second <link rel="stylesheet"> in the
// right place in the document head, and an FOUC bug is
// one missed step away.
//
// This config solves the second audience: src/embed.ts
// imports app.css with the ?inline query and injects it
// into a <style> tag at module init, so the whole SPA
// plus its stylesheet ship in one file. A host page
// integrates with a single line:
//
//   <transpareo-time-machine src="..."></transpareo-time-machine>
//   <script type="module" src="...embed.js"></script>
//
// The locale JSON files still code-split into
// `dist-embed/<lc>.js` chunks; the active locale loads
// dynamically and language switches don't pay for
// every locale upfront.
//
// Each script-tag deliverable is one self-contained file.
// Built together, the SPA embed and the <dpp-verifier>
// widget would share a chunk for their common code, and a
// host page could only discover that chunk after the entry
// had parsed: a second round trip on the critical path
// before anything else can start. So the two entries build
// one after the other (`--mode` picks the entry) into the
// same output tree, each carrying its own copy of the
// shared code.
//
// Whitespace is minified too. Vite keeps it for an ES lib
// build so a consuming bundler can still read the output,
// but a script tag is the consumer here, and the bytes go
// straight to the visitor.
//
// Run: npm run build:embed

// Matches the banner at the top of src/crypto/ed25519.ts.
const NOBLE_BANNER =
  '/*! noble-ed25519 - MIT License (c) 2019 Paul Miller (paulmillr.com) */';

const ENTRIES = {
  'embed': './src/embed.ts',
  'dpp-verifier': './src/dpp-verifier.ts',
} as const

type EntryName = keyof typeof ENTRIES

function entryFor(mode: string): EntryName {
  if (mode in ENTRIES) return mode as EntryName
  throw new Error(`embed build: unknown entry "${mode}"`)
}

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    outDir: 'dist-embed',

    // The first entry clears the tree; the second lands
    // next to it.
    emptyOutDir: entryFor(mode) === 'embed',
    minify: 'terser',

    // Mirror vite.config.ts: the public/ tree holds the
    // seeded fixture artefacts (manifest, snapshots,
    // EPCIS doc, branding, etc.) used by `npm run dev`
    // and embed-example.html. They are not part of the
    // shipped renderer and would otherwise leak into
    // the embed dist + the published npm tarball.
    copyPublicDir: false,
    lib: {
      // Two script-tag deliverables: the full SPA embed
      // and the standalone <dpp-verifier> widget (its
      // component inlines its own shadow-DOM CSS, so it
      // is single-file by construction). One per build,
      // see above.
      entry: {
        [entryFor(mode)]: fileURLToPath(
          new URL(ENTRIES[entryFor(mode)], import.meta.url),
        ),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      output: {
        // Locale chunks land alongside the main bundle
        // so a single CDN path serves everything.
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',

        // The vendored noble-ed25519 chunk ships under MIT,
        // whose notice-retention term the published
        // artefacts must honour; Rollup drops the source
        // file's `/*! ... */` banner during chunk
        // rendering, so it is re-applied here. Full license
        // text: THIRD-PARTY-LICENSES.md.
        banner: (chunk) => (
          chunk.name === 'ed25519' ? NOBLE_BANNER : ''
        ),
      },
    },
  },
}));
