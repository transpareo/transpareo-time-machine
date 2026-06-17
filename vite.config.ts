import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

// In dev the SPA proxies all DPP archive calls to the
// Rails resolver host (backend.dev). The Rails endpoint
// streams the archive bytes directly when storage is
// disk-backed and 302-redirects to the public CDN URL
// otherwise, same SPA code works against both.
//
// Self-signed certs are normal on dev hosts (the
// default `https://backend.dev`), so we skip TLS
// verification on those, but only on those. Real-cert
// staging / production hosts get full verification by
// default; opt out by setting `DPP_ARCHIVE_INSECURE=1`.
const archiveOrigin = process.env.DPP_ARCHIVE_ORIGIN
  ?? 'https://backend.dev';
const insecure =
  process.env.DPP_ARCHIVE_INSECURE === '1'
  || /\.(dev|test|local|localhost)(:|$|\/)/.test(archiveOrigin)
  || /\/\/(localhost|127\.0\.0\.1)(:|$|\/)/.test(archiveOrigin);

const proxyOpts = {
  target: archiveOrigin,
  changeOrigin: true,
  secure: !insecure,
};

// Dev-only fixture selection for the seeded demo pages.
// `npm run dev` serves the nordic-wear demo; `npm run
// dev:volturra` (or any `SEED=<fixture-id> vite`) swaps
// the manifest + branding that index.html and
// verifier.html point at, via the __SEED_ID__ /
// __SEED_CODE__ tokens in their markup. The id and code
// come straight from fixtures/<id>.yml so there's no
// second copy to drift. Production hosts hardcode their
// own manifest URL and never run this.
function devSeedSelect(): Plugin {
  const id = process.env.SEED ?? 'nordic-wear-tshirt';
  const code = seedCode(id);
  return {
    name: 'dev-seed-select',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html.replaceAll('__SEED_ID__', id).replaceAll('__SEED_CODE__', code),
  };
}

function seedCode(id: string): string {
  const dir = fileURLToPath(new URL('./fixtures', import.meta.url));
  let raw: string;
  try {
    raw = readFileSync(`${dir}/${id}.yml`, 'utf8');
  } catch {
    const have = readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => f.replace(/\.ya?ml$/, ''));
    throw new Error(
      `SEED='${id}' has no fixtures/${id}.yml. Available: ${have.join(', ')}`,
    );
  }
  const parsed = parseYaml(raw) as { code?: string };
  if (!parsed?.code) {
    throw new Error(`fixtures/${id}.yml has no 'code:' field`);
  }
  return parsed.code;
}

// Matches the banner at the top of src/crypto/ed25519.ts.
const NOBLE_BANNER =
  '/*! noble-ed25519 - MIT License (c) 2019 Paul Miller (paulmillr.com) */';

export default defineConfig({
  plugins: [devSeedSelect()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // Lib build, the bundler delivery shape. Emits
  // transpareo-time-machine.{js,css}, dpp-verifier.{js,css},
  // a shared chunk, and the per-locale chunks; nothing
  // else. The CDN serves the artefacts at a versioned
  // path so the host doesn't need to track content
  // hashes. Matches the frontend repo's bundle.{js,css}
  // convention.
  //
  // A bundler consumer wants the stylesheet as a
  // sibling asset they can fingerprint, reorder, and
  // inline alongside their own CSS, so the lib build
  // leaves `transpareo-time-machine.css` extracted. The
  // script-tag delivery shape lives in
  // vite.embed.config.ts: same source tree, same
  // registrations, only the CSS is inlined into the JS
  // so a no-build embedder gets one URL.
  //
  // Lib mode skips the standard HTML entry point and
  // public-dir copy, so the seeded demo data
  // (/public/<id>/dpp/..., /public/<id>/branding/,
  // dev index.html) stays in the repo for `npm run
  // dev` previewing but never leaks into dist/.
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    lib: {
      entry: {
        'transpareo-time-machine':
          fileURLToPath(new URL('./src/main.ts', import.meta.url)),
        'dpp-verifier':
          fileURLToPath(new URL('./src/dpp-verifier.ts', import.meta.url)),
      },
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        // Lib mode with a Record entry uses [name] for
        // the entry filename; the keys above become
        // transpareo-time-machine.js + dpp-verifier.js.
        // CSS per entry follows the same naming.
        entryFileNames: '[name].js',
        chunkFileNames: 'locales/[name].js',

        // The vendored noble-ed25519 chunk ships under MIT,
        // whose notice-retention term the published
        // artefacts must honour; Rollup drops the source
        // file's `/*! ... */` banner during chunk
        // rendering, so it is re-applied here. Full license
        // text: THIRD-PARTY-LICENSES.md.
        banner: (chunk) => (
          chunk.name === 'ed25519' ? NOBLE_BANNER : ''
        ),
        assetFileNames: (info) => {
          const name = info.names?.[0] ?? '';
          if (name === 'main.css') return 'transpareo-time-machine.css';
          return '[name][extname]';
        },
      },
    },
  },
  server: {
    proxy: {
      '/dpp': proxyOpts,
      '/.well-known': proxyOpts,

      // Resolver-side asset hosts the icon font + the
      // issuer mediafile bucket + the headline font the
      // SPA reuses; proxy only specific paths so we
      // don't shadow Vite's own /assets handling.
      '/admin/fonts': proxyOpts,
      '/app': proxyOpts,
      '/media': proxyOpts,

      // Publisher branding stylesheet; proxied so live
      // Style-Editor changes reach the SPA without a
      // redeploy.
      '/branding.css': proxyOpts,
    },
  },
});
