import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

// Dev can proxy DPP archive calls to a live resolver host,
// which streams the archive bytes directly when storage is
// disk-backed and 302-redirects to the public CDN URL
// otherwise; the same SPA code works against both.
//
// Opt in per machine with `DPP_ARCHIVE_ORIGIN=https://...`.
// There is no default host: `npm run seed` writes every
// artefact the renderer fetches into `public/`, so the dev
// server needs nothing else, and a default would send a
// contributor's requests to a domain this project does not
// control.
//
// Self-signed certs are normal on a development host, so
// TLS verification is skipped for `.dev` / `.test` /
// `.local` / localhost origins, and only for those.
// Real-cert staging and production hosts get full
// verification by default; opt out by setting
// `DPP_ARCHIVE_INSECURE=1`.
const archiveOrigin = process.env.DPP_ARCHIVE_ORIGIN;
const insecure = !!archiveOrigin && (
  process.env.DPP_ARCHIVE_INSECURE === '1'
  || /\.(dev|test|local|localhost)(:|$|\/)/.test(archiveOrigin)
  || /\/\/(localhost|127\.0\.0\.1)(:|$|\/)/.test(archiveOrigin)
);

const proxyOpts = archiveOrigin
  ? { target: archiveOrigin, changeOrigin: true, secure: !insecure }
  : undefined;

// Paths a resolver host serves when one is configured: the
// archive itself, the revocation feed, the asset hosts the
// SPA reuses (proxied by specific path so Vite's own
// /assets handling is not shadowed), and the publisher
// branding stylesheet, which is proxied so live Style-
// Editor changes reach the SPA without a redeploy. With no
// origin configured the map is empty and every one of these
// falls through to the seeded files under `public/`.
const proxyPaths = [
  '/dpp', '/.well-known', '/admin/fonts', '/app', '/media',
  '/branding.css'
];

const proxy = proxyOpts
  ? Object.fromEntries(proxyPaths.map((p) => [p, proxyOpts]))
  : {};

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

// The seed points a fixture's privateProperties URL at
// /api/authority/... (see emit-artefacts buildManifest). There
// is no auth server in the demo, so the private endpoint 401s
// with a login URL, and that login URL serves a stub standing
// in for the authorising system's real eIDAS / SSO flow. The
// SPA redirects the whole page to it: full-page hand-off, no
// credentials. Serve-only.
function devPrivateAuthMock(): Plugin {
  const LOGIN_PATH = '/api/authority/login';
  const STUB = '<!doctype html><html lang="en"><head>'
    + '<meta charset="utf-8"><title>Sign in</title></head>'
    + '<body style="font-family:system-ui;max-width:34rem;'
    + 'margin:5rem auto;padding:0 1rem;line-height:1.5">'
    + '<h1>eIDAS sign-in</h1>'
    + '<p>In production the authorising system runs its own '
    + 'eIDAS / SSO flow here, then returns you to the passport '
    + 'with a session.</p>'
    + '<p>This is a demo stub, so there is nothing to sign into.</p>'
    + '<button type="button" onclick="history.back()">'
    + 'Return to passport</button></body></html>';
  return {
    name: 'dev-private-auth-mock',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path === LOGIN_PATH) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(STUB);
          return;
        }
        if (!path?.startsWith('/api/authority/')) return next();
        res.statusCode = 401;
        res.setHeader('X-Auth-Url', LOGIN_PATH);
        res.end();
      });
    },
  };
}

// Matches the banner at the top of src/crypto/ed25519.ts.
const NOBLE_BANNER =
  '/*! noble-ed25519 - MIT License (c) 2019 Paul Miller (paulmillr.com) */';

export default defineConfig({
  plugins: [devSeedSelect(), devPrivateAuthMock()],

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
  server: { proxy },
});
