import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Resolve `dice-core` to its TypeScript source (see vite.config.js).
const SOURCE_CONDITIONS = ['source'];

export const TEST_EXTENSIONS = '{js,ts,mjs}';

// `npm run test:unit:wasm:coverage` (CI job unit-wasm): measure the headless
// engine on its own, with the compiled engine present, against its own floor.
// The two browser-only modules (the worker and its proxy) need a real Worker
// + SharedArrayBuffer and are covered by the verify:worker-* harnesses.
const DICE_CORE_COVERAGE = process.env.DICE_CORE_COVERAGE === '1';

const repoCoverage = {
    include: ['src/**/*.{js,ts}', 'packages/dice-core/src/**/*.ts'],
    // Repo-wide floor as of #348: statements 8.49%, branches 11.82%,
    // functions 9.19%, lines 8.23%. Ratchet up as more of src/ gets covered,
    // never down to make a red CI pass.
    thresholds: { lines: 8, statements: 8, functions: 9, branches: 11, perFile: false },
};

const diceCoreCoverage = {
    include: ['packages/dice-core/src/**/*.ts'],
    exclude: [
        'packages/dice-core/src/wasm/WorkerPhysicsBridge.ts',
        'packages/dice-core/src/wasm/dice_physics.worker.ts',
    ],
    // Measured with the goldens in: see the PR that added this block.
    thresholds: { lines: 70, statements: 70, functions: 55, branches: 60, perFile: false },
};

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
            ...(DICE_CORE_COVERAGE ? diceCoreCoverage : repoCoverage),
        },
    },
});
