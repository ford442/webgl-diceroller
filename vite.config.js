import { defaultClientConditions, defaultServerConditions, defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const COOP_COEP_HEADERS = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** Tier-0 assets: table/brick/wood textures, dice GLBs, transcoder wasm. */
const CRITICAL_PRELOADS = [
    'images/table_diff.ktx2',
    'images/table_nor.ktx2',
    'images/table_rough.ktx2',
    'images/brick_diffuse.ktx2',
    'images/wood_diffuse.ktx2',
    'images/dice/die_4.glb',
    'images/dice/die_6.glb',
    'images/dice/die_8.glb',
    'images/dice/die_10.glb',
    'images/dice/die_12.glb',
    'images/dice/die_20.glb',
    'draco/draco_decoder.wasm',
    'basis/basis_transcoder.wasm',
];

// `wasm/dice_physics.wasm` is deliberately NOT preloaded. It is instantiated by
// the Emscripten loader inside the physics worker (the default backend), and a
// document-level `<link rel=preload>` is never visible to a Worker: the page
// downloaded it for the link, the console warned "preloaded but not used within
// a few seconds", and the worker then fetched it again (#365).
// `verify:bundle-loading` asserts the artifact is requested exactly once.

/**
 * Build stamp (#380): which commit is live? Resolved once per build from, in
 * order, BUILD_COMMIT, GITHUB_SHA, `git rev-parse HEAD`. Only the commit and
 * version are compiled into the bundle (deterministic: the same checkout
 * builds the same chunks); the wall-clock build time lives only in the emitted
 * build-info.json, which the service worker never precaches.
 */
function git(...args) {
    try {
        return execFileSync('git', args, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return '';
    }
}

function resolveBuildInfo() {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
    const commit =
        process.env.BUILD_COMMIT || process.env.GITHUB_SHA || git('rev-parse', 'HEAD') || 'unknown';
    // Tracked-file changes only: the build writes untracked PWA icons / dist/.
    const dirty =
        commit !== 'unknown' && git('status', '--porcelain', '--untracked-files=no') !== '';
    return {
        version: pkg.version || '0.0.0',
        commit,
        shortCommit: commit === 'unknown' ? 'unknown' : commit.slice(0, 7),
        dirty,
    };
}

const BUILD_INFO = resolveBuildInfo();

function emitBuildInfo() {
    return {
        name: 'emit-build-info',
        apply: 'build',
        generateBundle() {
            const info = { ...BUILD_INFO, buildTime: new Date().toISOString() };
            this.emitFile({
                type: 'asset',
                fileName: 'build-info.json',
                source: `${JSON.stringify(info, null, 2)}\n`,
            });
        },
    };
}

function joinPublicHref(base, relativePath) {
    const dirBase = base.endsWith('/') ? base : `${base}/`;
    return `${dirBase}${relativePath.replace(/^\//, '')}`;
}

function injectCriticalPreloads() {
    let base = './';
    return {
        name: 'inject-critical-preloads',
        configResolved(config) {
            base = config.base || './';
        },
        transformIndexHtml(html) {
            const tags = CRITICAL_PRELOADS.map(
                (href) =>
                    `<link rel="preload" href="${joinPublicHref(base, href)}" as="fetch" crossorigin>`
            ).join('\n    ');
            return html.replace('</head>', `    ${tags}\n  </head>`);
        },
    };
}

/**
 * Workspace packages (packages/dice-core) export their TypeScript sources under
 * the `source` condition and compiled `dist/` for everyone else, so the app,
 * its workers and vitest bundle the sources with no prebuild step.
 */
export const SOURCE_CONDITIONS = ['source'];

export default defineConfig({
    base: './',
    resolve: {
        conditions: [...SOURCE_CONDITIONS, ...defaultClientConditions],
    },
    ssr: {
        resolve: {
            conditions: [...SOURCE_CONDITIONS, ...defaultServerConditions],
            externalConditions: [...SOURCE_CONDITIONS],
        },
    },
    server: {
        open: process.env.BROWSER === 'none' ? false : true,
        allowedHosts: ['code.noahcohn.com', 'localhost', '127.0.0.1'],
        headers: COOP_COEP_HEADERS,
    },
    preview: {
        headers: COOP_COEP_HEADERS,
    },
    worker: {
        format: 'es',
    },
    publicDir: 'public',
    define: {
        __BUILD_COMMIT__: JSON.stringify(BUILD_INFO.commit),
        __BUILD_VERSION__: JSON.stringify(BUILD_INFO.version),
    },
    assetsInclude: ['**/*.wasm'],
    plugins: [
        injectCriticalPreloads(),
        emitBuildInfo(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: [
                'favicon.svg',
                'pwa-192x192.png',
                'pwa-512x512.png',
                'draco/**/*',
                'basis/**/*',
                'wasm/**/*',
                'wasm-scalar/**/*',
                'images/dice/*.glb',
            ],
            manifest: {
                name: 'WebGPU Dice Roller',
                short_name: 'Dice Roller',
                description: '3D tavern dice roller with realistic physics',
                theme_color: '#0a0a0a',
                background_color: '#0a0a0a',
                display: 'standalone',
                orientation: 'any',
                start_url: './',
                scope: './',
                icons: [
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                ],
            },
            workbox: {
                // A redeploy's worker activates at once and drops the previous build's
                // precache; docs/DEPLOYMENT.md ("Cache policy") has the full story.
                skipWaiting: true,
                clientsClaim: true,
                cleanupOutdatedCaches: true,
                globPatterns: [
                    '**/*.{js,css,html,ico,svg,wasm,json}',
                    'images/dice/*.glb',
                    // The textures and the lamp mesh the tavern cannot draw without. They used
                    // to be runtime-cached only, but a runtime cache fills only from requests
                    // made *while the worker controls the page*, which the first visit's are
                    // not: go offline right after the first load and the reload could not
                    // build the scene (#383, test:edge-cases "offline after the first load").
                    'images/**/*.ktx2',
                    'images/props/*.glb',
                    'draco/**/*',
                    'basis/**/*',
                    'wasm/**/*',
                    'wasm-scalar/**/*',
                ],
                // The JPGs are the rare KTX2-failure fallback: never precached, and
                // runtime-cached (below) only if something actually asks for them.
                // build-info.json must always come from the network: a precached copy would
                // report the previous deploy's commit.
                globIgnores: ['**/images/**/*.jpg', 'build-info.json'],
                navigateFallback: 'index.html',
                navigateFallbackDenylist: [/^\/wasm\//, /build-info\.json$/],
                runtimeCaching: [
                    {
                        urlPattern: /\/images\/.*\.(ktx2|jpe?g|png)$/i,
                        // Texture file names are not content-hashed, so CacheFirst would pin
                        // a re-encoded texture to every returning visitor for a year.
                        // StaleWhileRevalidate serves the cached copy instantly (offline
                        // works) and refreshes it in the background for the next load.
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'texture-cache',
                            expiration: {
                                maxEntries: 256,
                                maxAgeSeconds: 60 * 60 * 24 * 365,
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                    {
                        urlPattern: /\/images\/props\/.*\.glb$/i,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'prop-mesh-cache',
                            expiration: {
                                maxEntries: 32,
                                maxAgeSeconds: 60 * 60 * 24 * 365,
                            },
                        },
                    },
                ],
            },
            devOptions: {
                enabled: false,
            },
        }),
    ],
    build: {
        target: 'esnext',
        // Largest chunk is `three` (~840 kB raw / ~235 kB gzip) and `index` (~540 kB).
        // Rollup's 500 kB default warned on every build and would hide a new
        // problem chunk; 900 kB sits just above the known ones, and the real
        // regression gate is scripts/bundle-budgets.json (gzip, per chunk).
        chunkSizeWarningLimit: 900,
        modulePreload: {
            polyfill: true,
            resolveDependencies(filename, deps) {
                // Never modulepreload the lazy WebGPU/TSL chunk. The
                // 'three.webgpu' / 'three.tsl' substrings here are the
                // manualChunks output name above — keep them in sync.
                return deps.filter(
                    (dep) => !dep.includes('three.webgpu') && !dep.includes('three.tsl')
                );
            },
        },
        rollupOptions: {
            output: {
                manualChunks(id) {
                    // Keep the ~300 KB LTC BRDF tables out of the shared `three`
                    // chunk: only the WebGPU high-quality accent rig imports them
                    // (AccentLightRig.js), and it does so dynamically. Letting
                    // Rollup emit them as their own async chunk means WebGL,
                    // mobile and XR never download them.
                    if (id.includes('RectAreaLightTexturesLib')) return;
                    // WebGPU backend + TSL: only reachable via dynamic import
                    // (SceneSetup.js, AccentLightRig.js, RendererFactory.ts,
                    // GodRayNodeMaterial.js). Must be split out BEFORE the
                    // generic 'three' catch-all below, which would otherwise
                    // match these paths too (they live under node_modules/three)
                    // and hoist them into the eager chunk every session pays for.
                    if (id.includes('node_modules/three/build/three.webgpu')) return 'three.webgpu';
                    if (id.includes('node_modules/three/build/three.tsl')) return 'three.webgpu';
                    // TSL/Node postprocessing addons (BloomNode, FXAANode, ...):
                    // only ever reached alongside the dynamic three/webgpu +
                    // three/tsl import in SceneSetup.js, but their path doesn't
                    // match the build/ patterns above. Leaving them to fall
                    // through to the 'three' catch-all put them in the eager
                    // chunk AND made it statically import from 'three.webgpu'
                    // (since these files themselves import 'three/webgpu' and
                    // 'three/tsl'), reintroducing the eager WebGPU payload this
                    // split exists to remove and creating a chunk cycle.
                    if (id.includes('node_modules/three/examples/jsm/tsl/')) return 'three.webgpu';
                    if (id.includes('node_modules/three')) return 'three';
                },
            },
        },
    },
});
