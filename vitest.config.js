import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Same as vite.config.js: resolve workspace packages to their TS sources.
const SOURCE_CONDITIONS = ['source'];

/** Test globs per project (vitest-include-glob.test.js parses these). */
export const DICE_CORE_INCLUDE = ['packages/dice-core/test/**/*.test.{js,ts,mjs}'];
export const APP_INCLUDE = ['tests/unit/**/*.test.{js,ts,mjs}'];

// `npm run test:core:coverage` (the unit-wasm CI job, which has the compiled
// engine): measure packages/dice-core alone against its own, much higher
// floor. The browser-only seams — the worker module and the page-side worker
// proxy — are exercised by the Playwright harnesses (verify:worker-*), not by
// Node, so they are excluded here rather than dragging the floor down.
const coreCoverage = process.env.DICE_CORE_COVERAGE === '1';

/** @type {import('vitest/node').CoverageOptions} */
const coverage = coreCoverage
    ? {
          provider: 'v8',
          reporter: ['text-summary', 'lcov'],
          include: ['packages/dice-core/src/**/*.ts'],
          exclude: [
              'packages/dice-core/src/**/*.d.ts',
              'packages/dice-core/src/wasm/dice_physics.worker.ts',
              'packages/dice-core/src/wasm/WorkerPhysicsBridge.ts',
          ],
          // Real numbers as of this change (WASM artifacts present): lines
          // 74.1%, statements 71.3%, branches 63.3%, functions 58.5% (the
          // no-WASM stub engine is ~80 never-called one-liners). Ratchet up.
          thresholds: {
              lines: 70,
              statements: 70,
              functions: 55,
              branches: 60,
              perFile: false,
          },
      }
    : {
          provider: 'v8',
          reporter: ['text', 'lcov'],
          include: ['src/**/*.{js,ts}'],
          // App units only (`--project app` in the build-js job, no WASM).
          // Real numbers as of this change: statements 10.21%, branches
          // 10.71%, functions 10.7%, lines 10.32%. The core moved out to
          // packages/dice-core with its own 70% gate, which shifted both the
          // numerator and the denominator here (branches dipped from 11.8%).
          // Ratchet these up as more of src/ gets covered, never down to
          // make a red CI pass.
          thresholds: {
              lines: 10,
              statements: 10,
              functions: 10.5,
              branches: 10.5,
              perFile: false,
          },
      };

export default defineConfig({
    resolve: {
        conditions: [...SOURCE_CONDITIONS, ...defaultClientConditions],
    },
    ssr: {
        resolve: {
            conditions: [...SOURCE_CONDITIONS, ...defaultServerConditions],
            externalConditions: [...SOURCE_CONDITIONS],
        },
    },
    test: {
        coverage,
        projects: [
            {
                extends: true,
                test: {
                    name: 'dice-core',
                    include: DICE_CORE_INCLUDE,
                    // The package has no DOM; neither do its tests.
                    environment: 'node',
                    setupFiles: ['packages/dice-core/test/setup-storage.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'app',
                    include: APP_INCLUDE,
                    environment: 'happy-dom',
                    setupFiles: ['tests/unit/setup-canvas.js'],
                },
            },
        ],
    },
});
