import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/unit/**/*.test.js'],
        environment: 'happy-dom',
        setupFiles: ['tests/unit/setup-canvas.js'],
    },
});
