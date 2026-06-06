import { defineConfig } from 'vite';

export default defineConfig({
  base: '/dice-roller/',
  server: {
    open: true,
    allowedHosts: ['code.noahcohn.com', 'localhost', '127.0.0.1'],
    headers: {
      // COOP/COEP headers are required for SharedArrayBuffer which will be
      // used in Phase 3+ multi-threaded WASM.  Adding them now avoids a
      // hard deployment change later.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    }
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
