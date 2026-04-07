import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: true,
    allowedHosts: ['code.noahcohn.com', 'localhost', '127.0.0.1']
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
