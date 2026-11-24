# Deployment

How a production bundle is built from a fresh checkout, deployed, and verified.
Release tracking: #378 (this page: #380; cache policy and redeploy: #383).

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

### Size budgets

`npm run gates` runs `check:bundle-size` (per-chunk and eager-total gzip budgets)
and `check:deploy-size` (raw `dist/` bytes, printed by directory). Both read
`scripts/bundle-budgets.json`, where every budget change carries its reason.

- `index` (the entry chunk) is held at 175 kB gzip. Features not needed on every
  boot sit behind `import()` and have their own budgeted chunk: `MultiplayerRoom`
  (only when a signaling URL resolves), `GameTable` (first "Play Farkle"),
  `RenderStats` (`?debug`), `XrAppWiring` (`?xr` / `?ar`). A new feature that is
  not needed to draw the tavern belongs behind an import, not in `index`.
- `deploySizeMaxBytes` is 8.5 MiB: a full build (both physics profiles) measures
  7.78 MiB (8,161,736 B). `check:deploy-size` says so when the WASM artifacts are
  missing, because that bundle is not a releasable size.
- Shipped on purpose although a modern browser rarely reads them: the fallback
  JPGs next to each KTX2 texture (~2.1 MB, fetched only when KTX2 decoding fails,
  never precached). Dropped because nothing can reach them: Draco's asm.js
  `draco_decoder.js` (719 kB; the app cannot run without WebAssembly), an
  unreferenced lamp texture, a `.url` shortcut, and the dev-only WASM test page
  (now `scripts/dev/`).

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

## Cache policy

Three kinds of file, three policies. The host sets them (the storage-manager
host is configured outside this repo; the snippets below are what to ask for),
and `npm run verify:cache-headers -- <url>` checks a live site and prints the
`cache-control` / `content-type` it got for one file of each class.

| Class              | Paths                                                                               | `Cache-Control`                                        | Why                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Shell              | `index.html`, `/`, `sw.js`, `registerSW.js`, `workbox-*.js`, `manifest.webmanifest` | `no-cache`                                             | These name every other file. A stale copy pins a visitor (and their service worker) to an old deploy. |
| Build stamp        | `build-info.json`                                                                   | `no-cache` (or `no-store`)                             | Read to learn which commit is live; a cached copy reports the previous deploy.                        |
| Hashed bundles     | `assets/*-<hash>.js` / `.css`                                                       | `public, max-age=31536000, immutable`                  | Content-addressed: the name changes when the bytes do.                                                |
| Engine (un-hashed) | `wasm/*`, `wasm-scalar/*` (`dice_physics.js`, `.wasm`, `hulls.json`)                | `no-cache`; `.wasm` served as `application/wasm`       | Tied to the build (`solverBuildId`); a stale engine beside a new bundle fails the room check.         |
| Static (un-hashed) | `images/**`, `draco/**`, `basis/**`                                                 | `public, max-age=86400, stale-while-revalidate=604800` | Rarely change but the names are not hashed, so never `immutable`.                                     |

All of them also carry the COOP / COEP / CORP headers below.

### Where the live host stands (checked 2026-11-24, read-only)

`npm run verify:cache-headers -- https://test.1ink.us/dice-roller/` against the
staging host that `deploy.py --target staging` writes to: **7 of 9 checked paths
violate the policy**. It sends `Cache-Control: max-age=172800` (48 h) on `sw.js`,
`registerSW.js`, `manifest.webmanifest`, `build-info.json`, the hashed bundles and
`wasm/dice_physics.wasm`, and `max-age=600` on `index.html`; no `immutable` anywhere.
Content types are right (`application/wasm`, `model/gltf-binary`), COOP / COEP are
present. Consequences, in order of how much they matter:

- `build-info.json` can report a stale commit for two days unless fetched with a
  cache-busting query (`?cb=`), which is why the runbook and `deploy.py` use one.
- `index.html` may be up to 10 min stale on a first visit (no service worker yet).
- `wasm/*` is cached 48 h next to a bundle that may have moved on; a service
  worker that already holds the precache is unaffected (its revisions are checked
  by hash), a first-time visitor is not.
- Browsers ignore a long `max-age` on the service-worker script itself when
  checking for updates, so the update path still works; it is the other files that
  need fixing.

The host is configured outside this repo; the snippets below are the change to ask
its owner for. Re-run the command afterwards; it exits non-zero until the table matches.

### What the service worker does on a redeploy

`vite-plugin-pwa` (`generateSW`, `registerType: 'autoUpdate'`) with
`skipWaiting`, `clientsClaim` and `cleanupOutdatedCaches` set explicitly:

1. A returning visitor's browser re-fetches `sw.js` (it is `no-cache`, and the
   browser bypasses the HTTP cache for it anyway), sees new precache revisions
   and installs the new worker.
2. The new worker activates at once, takes over open tabs and **deletes the
   previous build's precache**. The open tab is still the old build in memory.
   It is told (`UpdateNotice.ts`: `controllerchange` while it already had a
   controller) and shows a "A new version is ready" banner with a Reload
   button. It is **not** reloaded automatically: a roll may be in flight.
3. The next load is served from the new precache: the new `index.html`, the new
   hashed chunks. Textures, props and the dice GLBs are runtime-cached
   `StaleWhileRevalidate` (they are un-hashed, so `CacheFirst` would have pinned
   a re-encoded texture to returning visitors for a year).
4. `build-info.json` is never precached or served as the navigation fallback.

An old tab that lazily imports a chunk after step 2 asks the new worker for an
old hashed name. That works if the host still has the old file and 404s if it
was pruned. `deploy.py` **does not delete remote files** and `assets/` names are
hashed, so old builds' chunks stay available to old tabs by default; prune them
only on a schedule longer than a session. When one is gone anyway:

### Stale-chunk recovery

A failed dynamic import (`Failed to fetch dynamically imported module`, Vite's
`vite:preloadError`, an unhandled rejection with that message) is a stale page,
not a broken app. `src/core/StaleChunkRecovery.ts` reloads **once** (remembered
in `sessionStorage` for 60 s). A second failure inside the window, or no
usable `sessionStorage` (it could not remember the attempt, so a reload might
loop), shows the banner "This page is out of date" with **Reload** and **Clear
cache & reload** (unregisters the worker, deletes the caches, reloads).

### Redeploy runbook (staging)

```bash
npm run build && npm run gates
python3 deploy.py --target staging                      # first build: note the SHA it prints
# in a browser, open the staging URL once so it holds build 1's service worker
# change something trivial, rebuild, deploy again
python3 deploy.py --target staging
# the open tab shows "A new version is ready"; Reload; then:
curl -s "https://test.1ink.us/dice-roller/build-info.json?cb=$(date +%s)"   # the new commit
npm run verify:cache-headers -- https://test.1ink.us/dice-roller/
```

`npm run test:sw-redeploy` runs this whole sequence locally (two builds served
from a swappable directory with the headers above) and fails on any 404 or
console error during the update.

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
    add_header Cache-Control "public, max-age=86400, stale-while-revalidate=604800" always;

    # nginx does not inherit add_header into a block that defines its own:
    # every nested location repeats the isolation headers.
    location ~* /dice-roller/(sw\.js|registerSW\.js|workbox-[^/]+\.js|build-info\.json|index\.html|manifest\.webmanifest)$ {
        add_header Cross-Origin-Opener-Policy   "same-origin"  always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Resource-Policy "same-origin"  always;
        add_header Cache-Control "no-cache" always;
    }
    location ^~ /dice-roller/assets/ {
        add_header Cross-Origin-Opener-Policy   "same-origin"  always;
        add_header Cross-Origin-Embedder-Policy "require-corp" always;
        add_header Cross-Origin-Resource-Policy "same-origin"  always;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }
    location ~ ^/dice-roller/wasm(-scalar)?/ {
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
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
/registerSW.js
  Cache-Control: no-cache
/workbox-*
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
/build-info.json
  Cache-Control: no-cache
/wasm/*
  Cache-Control: no-cache
/wasm-scalar/*
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

The storage-manager host that serves `test.1ink.us` is configured outside this
repo; ask its owner for the equivalent of one of the blocks above, then confirm
with `npm run verify:production-isolation -- <url>` (isolation) and `npm run verify:cache-headers -- <url>` (cache policy).
