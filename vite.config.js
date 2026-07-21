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
    './images/table_diff.ktx2',
    './images/table_nor.ktx2',
    './images/table_rough.ktx2',
    './images/brick_diffuse.ktx2',
    './images/wood_diffuse.ktx2',
    './images/dice/die_4.glb',
    './images/dice/die_6.glb',
    './images/dice/die_8.glb',
    './images/dice/die_10.glb',
    './images/dice/die_12.glb',
    './images/dice/die_20.glb',
    './draco/draco_decoder.wasm',
    './basis/basis_transcoder.wasm',
];

if (existsSync(resolve('public/wasm/dice_physics.wasm'))) {
    CRITICAL_PRELOADS.push('./wasm/dice_physics.wasm');
}

function injectCriticalPreloads() {
    return {
        name: 'inject-critical-preloads',
        transformIndexHtml(html) {
            const tags = CRITICAL_PRELOADS.map(
                (href) => `<link rel="preload" href="${href}" as="fetch" crossorigin>`
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
                // Never modulepreload lazy renderer / physics chunks.
                return deps.filter(
                    (dep) =>
                        !dep.includes('three.webgpu')
                        && !dep.includes('three.tsl')
                        && !dep.includes('/physics-')
                        && !dep.includes('/ammo-')
                );
            },
        },
        rollupOptions: {
            output: {
                manualChunks: {
                    three: ['three'],
                    physics: ['ammo.js'],
                },
            },
        },
    },
});
