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
// Same source tree, same custom element registration,
// same shared chunks - only the CSS delivery differs.
//
// Run: npm run build:embed

// Matches the banner at the top of src/crypto/ed25519.ts.
const NOBLE_BANNER =
  '/*! noble-ed25519 - MIT License (c) 2019 Paul Miller (paulmillr.com) */';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    outDir: 'dist-embed',
    emptyOutDir: true,

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
      // is single-file by construction). Shared code
      // splits into common chunks next to them; ES module
      // imports resolve those relative to the CDN dir.
      entry: {
        'embed': fileURLToPath(new URL('./src/embed.ts', import.meta.url)),
        'dpp-verifier': fileURLToPath(new URL('./src/dpp-verifier.ts', import.meta.url)),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      output: {
        // Locale chunks land alongside the main bundle
        // so a single CDN path serves everything. The
        // <dpp-verifier> component chunk (shared by both
        // entries) would collide with the dpp-verifier.js
        // entry file, so it gets an explicit name instead
        // of Rollup's dedupe counter (dpp-verifier2.js).
        chunkFileNames: (chunk) => (
          chunk.name === 'dpp-verifier'
            ? 'dpp-verifier-core.js'
            : '[name].js'
        ),
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
});
