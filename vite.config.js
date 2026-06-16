import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    open: true,
    allowedHosts: ['code.noahcohn.com', 'localhost', '127.0.0.1'],
    headers: {
      // COOP/COEP headers are required for SharedArrayBuffer, used by the
      // Phase 4 worker-physics transport. Without cross-origin isolation the
      // worker bridge transparently falls back to postMessage snapshots.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    }
  },
  preview: {
    // Mirror the dev headers so `npm run preview` (and any static host that
    // copies this config) is also cross-origin isolated and can use the
    // SharedArrayBuffer fast path. NOTE: production hosting (test.1ink.us /
    // go.1ink.us) must emit these same two headers, or the worker silently
    // drops to the slower postMessage transport.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    }
  },
  // The worker bundle (dice_physics.worker.js) is an ES module worker.
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      'three': 'three'
    }
  },
  // Ensure assets are served correctly
  publicDir: 'public',
  // Treat .wasm files as assets so Vite copies them to dist/ unchanged
  assetsInclude: ['**/*.wasm'],
  build: {
    target: 'esnext',
    modulePreload: {
      polyfill: true,
    },
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          physics: ['ammo.js'],
        }
      }
    }
  }
});
