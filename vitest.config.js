import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/unit/**/*.test.{js,ts,mjs}'],
        environment: 'happy-dom',
        setupFiles: ['tests/unit/setup-canvas.js'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['src/**/*.{js,ts}'],
            // Real numbers as of this change: statements 8.49%, branches
            // 11.82%, functions 9.19%, lines 8.23%. Thresholds sit a little
            // below that so incidental coverage drift doesn't fail CI —
            // ratchet these up as more of src/ gets covered, never down to
            // make a red CI pass.
            thresholds: {
                lines: 8,
                statements: 8,
                functions: 9,
                branches: 11,
                perFile: false,
            },
        },
    },
});
