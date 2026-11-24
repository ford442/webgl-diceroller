# Deployment

How a production bundle is built from a fresh checkout, deployed, and verified.
Release tracking: #378 (this page: #380).

## Fresh checkout → `dist/` (CI-equivalent)

Needs Node 22 and an Emscripten SDK matching `EMSDK_VERSION` in
`.github/workflows/ci.yml` (currently **3.1.61**; `source emsdk_env.sh` first).

```bash
git clone https://github.com/ford442/webgl-diceroller.git && cd webgl-diceroller
rm -rf node_modules dist
npm ci
npm run build              # build:wasm (SIMD + scalar) then `vite build`
npm run gates              # check:bundle-size, check:deploy-size, check:cycles,
                           # typecheck, lint, format:check
```

`npm run release:build` is `build` followed by `gates`. Run `npm run test:unit`
(and `npm run test:solver`) as well before cutting a release; both are CI gates.

Notes:

- **`build:js` vs `build`.** `npm run build:js` assumes `public/wasm/` and
  `public/wasm-scalar/` already exist and fails fast without them. Without an
  Emscripten SDK use `build:js:allow-missing-wasm`: it ships a bundle with no
  dice simulation, so never deploy it. Workbox then warns that the
  `wasm-scalar/**/*` glob matches nothing; that is expected for that bundle
  only. A full build is warning-free.
- **Chunk-size warning.** `build.chunkSizeWarningLimit` is 900 kB (the largest
  chunk, `three`, is ~840 kB raw / ~235 kB gzip). The real gate is the
  per-chunk gzip budget in `scripts/bundle-budgets.json`; each budget change
  carries a written reason next to it.
- **WASM parity.** `npm run verify:cmake-wasm` byte-diffs `build.sh` against
  CMake. `build.sh` passes flags _before_ the inputs, as CMake's link line does:
  the order moves libc++'s RTTI strings in the data segment, so swapping it
  fails parity by ~11 bytes with identical behaviour.

### Build stamp

Every build writes `dist/build-info.json`:

```json
{
    "version": "0.1.0",
    "commit": "<full sha>",
    "shortCommit": "ed55356",
    "dirty": false,
    "buildTime": "2026-11-24T04:01:22.830Z"
}
```

- `commit` comes from `BUILD_COMMIT`, then `GITHUB_SHA`, then `git rev-parse HEAD`.
  `dirty` is true if tracked files differ from `HEAD`; `deploy.py` refuses to
  send a dirty build to production.
- The commit and version are compiled into the bundle (`src/core/BuildInfo.ts`,
  via Vite `define`): the `?debug` HUD shows `build <short sha> · v<version>` and
  `window.__app.buildInfo` (under `?test` / `?debug`) holds the same. The build
  _time_ is only in the JSON, so the same checkout builds the same chunks.
- `build-info.json` is excluded from the service worker precache and from its
  navigation fallback, so reading it from a live site always hits the network.
  Fetch it with a cache-busting query when checking a deploy:
  `curl -s "https://<host>/dice-roller/build-info.json?cb=$(date +%s)"`.

## Deploying

`deploy.py` uploads `dist/` through the storage manager.

```bash
pip install requests
export DEPLOY_TOKEN=...           # required; the script exits if it is unset
python deploy.py --target staging # https://test.1ink.us/dice-roller/ (site "test")
python deploy.py --target production --confirm-production   # see below
python deploy.py --dry-run        # list what would upload
```

- **Token.** Read from `DEPLOY_TOKEN` only; there is no default and none in the
  repo. A token that was once committed (visible in git history) must be
  **rotated at the storage manager**, since removing it from the working tree
  does not revoke it. Rotation is an owner action, and it is the only way to
  invalidate the old value.
- **Targets.** `--target` / `DEPLOY_TARGET`: `staging` (default) or
  `production`. Staging defaults can be overridden with `DEPLOY_STAGING_SITE` /
  `DEPLOY_STAGING_URL`. Production requires `DEPLOY_PRODUCTION_SITE` (the
  storage manager's site name), optionally `DEPLOY_PRODUCTION_URL` (default
  `https://go.1ink.us/dice-roller/`), and `--confirm-production`.
- **What uploads.** Each deploy writes a `deploy-manifest.json` (sha256 of every
  file). The next deploy reads it back from the live site and skips a file only
  if its size _and_ hash match. `index.html`, `sw.js`, `registerSW.js`,
  `manifest.webmanifest`, `build-info.json` and `workbox-*.js` always upload.
  `--force` uploads everything.
- **Verification.** After upload the script reads `build-info.json` back from the
  live URL (the commit must equal `dist/build-info.json`) and checks the
  `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` response headers.
  Exit codes: `0` ok, `1` upload failed, `2` uploaded but verification failed.
- Tests: `python3 -m unittest discover -s tests/python`.

After a deploy:

```bash
curl -sI https://test.1ink.us/dice-roller/ | grep -i '^cross-origin'
curl -s "https://test.1ink.us/dice-roller/build-info.json?cb=$(date +%s)"
npm run verify:production-isolation -- https://test.1ink.us/dice-roller/
```

## Required response headers

`SharedArrayBuffer` (the worker-physics fast path) needs the page to be
cross-origin isolated, and a `<meta http-equiv>` tag does not count: the
headers must come from the host. `vite dev` / `vite preview` set them from
`vite.config.js`; a static host must too. Send them on every response (HTML,
JS, WASM, workers), at least:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

CORP matters when another origin embeds sub-resources. Every asset here is
same-origin, so `same-origin` is safe. Keep `sw.js` out of long caching.

### nginx

```nginx
location /dice-roller/ {
    add_header Cross-Origin-Opener-Policy   "same-origin"  always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;
    add_header Cross-Origin-Resource-Policy "same-origin"  always;

    # Repeat these in any nested `location` with its own add_header: nginx does
    # not inherit add_header into a block that defines one.
    location ~* /dice-roller/(sw\.js|registerSW\.js|build-info\.json|index\.html|manifest\.webmanifest)$ {
        add_header Cross-Origin-Opener-Policy   "same-origin"  always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Resource-Policy "same-origin"  always;
        add_header Cache-Control "no-cache" always;
    }
    types { application/wasm wasm; }
}
```

### Caddy

```caddy
handle_path /dice-roller/* {
    header {
        Cross-Origin-Opener-Policy   "same-origin"
        Cross-Origin-Embedder-Policy "require-corp"
        Cross-Origin-Resource-Policy "same-origin"
    }
    root * /var/www/dice-roller
    file_server
}
```

### Apache (`.htaccess`, needs `mod_headers`)

```apache
<IfModule mod_headers.c>
    Header always set Cross-Origin-Opener-Policy   "same-origin"
    Header always set Cross-Origin-Embedder-Policy "require-corp"
    Header always set Cross-Origin-Resource-Policy "same-origin"
</IfModule>
AddType application/wasm .wasm
```

### Netlify / Cloudflare Pages (`_headers`)

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
```

The storage-manager host that serves `test.1ink.us` is configured outside this
repo; ask its owner for the equivalent of one of the blocks above, then confirm
with `npm run verify:production-isolation -- <url>`.
