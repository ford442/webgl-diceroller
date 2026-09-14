import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

if (existsSync(resolve('public/wasm/dice_physics.wasm'))) {
    CRITICAL_PRELOADS.push('wasm/dice_physics.wasm');
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

export default defineConfig({
    base: './',
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
    assetsInclude: ['**/*.wasm'],
    plugins: [
        injectCriticalPreloads(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: [
                'vite.svg',
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
                globPatterns: [
                    '**/*.{js,css,html,ico,svg,wasm,json}',
                    'images/dice/*.glb',
                    'draco/**/*',
                    'basis/**/*',
                    'wasm/**/*',
                    'wasm-scalar/**/*',
                ],
                // Large JPG/KTX2 textures: runtime cache-first instead of precache.
                globIgnores: ['**/images/**/*.jpg', '**/images/**/*.ktx2', '**/images/lamp/**'],
                navigateFallback: 'index.html',
                navigateFallbackDenylist: [/^\/wasm\//],
                runtimeCaching: [
                    {
                        urlPattern: /\/images\/.*\.(ktx2|jpe?g|png)$/i,
                        handler: 'CacheFirst',
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
                        handler: 'CacheFirst',
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
