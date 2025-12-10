import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: true
  },
  resolve: {
    alias: {
      'three': 'three'
    }
  },
  // Ensure assets are served correctly
  publicDir: 'public',
  build: {
    target: 'esnext'
  }
});
