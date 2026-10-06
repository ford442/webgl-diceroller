import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Resolve `dice-core` to its TypeScript source (see vite.config.js).
const SOURCE_CONDITIONS = ['source'];

export const TEST_EXTENSIONS = '{js,ts,mjs}';

export default defineConfig({
    resolve: {
        conditions: [...SOURCE_CONDITIONS, ...defaultClientConditions],
    },
    ssr: {
        resolve: {
            conditions: [...SOURCE_CONDITIONS, ...defaultServerConditions],
            externalConditions: SOURCE_CONDITIONS,
        },
    },
    test: {
        projects: [
            {
                // The headless engine, in the environment its consumers run it
                // in: Node, no DOM.
                extends: true,
                test: {
                    name: 'dice-core',
                    environment: 'node',
                    include: [`packages/dice-core/test/**/*.test.${TEST_EXTENSIONS}`],
                    exclude: [`packages/dice-core/test/**/*.wasm.test.${TEST_EXTENSIONS}`],
                    setupFiles: ['packages/dice-core/test/memoryStorage.setup.ts'],
                },
            },
            {
                // Tests of the compiled engine. The setup file throws without
                // public/wasm + public/wasm-scalar: never a silent skip.
                extends: true,
                test: {
                    name: 'dice-core-wasm',
                    environment: 'node',
                    include: [`packages/dice-core/test/**/*.wasm.test.${TEST_EXTENSIONS}`],
                    setupFiles: ['packages/dice-core/test/requireWasm.setup.ts'],
                    testTimeout: 60_000,
                },
            },
            {
                extends: true,
                test: {
                    name: 'ui',
                    environment: 'happy-dom',
                    include: [`tests/unit/**/*.test.${TEST_EXTENSIONS}`],
                    setupFiles: ['tests/unit/setup-canvas.js'],
                },
            },
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['src/**/*.{js,ts}', 'packages/dice-core/src/**/*.ts'],
            // Repo-wide floor as of #348: statements 8.49%, branches 11.82%,
            // functions 9.19%, lines 8.23%. Ratchet up as more of src/ gets
            // covered, never down to make a red CI pass.
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
