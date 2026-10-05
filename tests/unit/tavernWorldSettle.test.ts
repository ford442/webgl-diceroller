// @vitest-environment node
/**
 * #341 acceptance, WASM side: rolls into the collider world the tavern
 * actually builds (tests/fixtures/tavern-world.json, `npm run fixture:world`)
 * must settle inside 12 s of simulated time. The native twin is the
 * "Tavern world" case in src/wasm/solver_tests.cpp.
 *
 * 24 seeds by default to keep `npm run test:unit` quick; `npm run
 * test:tavern-world` runs the full 200 (TAVERN_SEEDS). Skips without WASM
 * artifacts, except in the dedicated CI job, where that is an error.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rollHeadless, wasmArtifactsPresent } from '../../src/core-engine/index.js';
import type { WorldFixture } from '../../src/core-engine/wasm/WorldRecorder.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const world = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'tests/fixtures/tavern-world.json'), 'utf8')
) as WorldFixture;

const SEEDS = Number(process.env.TAVERN_SEEDS) || 24;
const MAX_SIM_SECONDS = 12;
const DT = 1 / 120;
const EXPRESSIONS = [
    '1d20',
    '1d20+1d6',
    '1d4+1d8+1d12',
    '2d6+1d10',
    '1d20+1d12+1d10+1d8',
    '3d6+2d20',
];

describe('tavern world fixture', () => {
    it('is a recorded world with the table, walls and props', () => {
        expect(world.version).toBe(1);
        expect(world.init).not.toBeNull();
        // Table surface + velvet zone (Table.js) are both registered.
        const tops = world.statics
            .filter((s) => s.type === 'box')
            .map((s) => (s.type === 'box' ? s.center[1]! + s.halfExtents[1]! : 0));
        expect(tops).toContain(1);
        expect(tops.some((y) => Math.abs(y - 1.1) < 1e-6)).toBe(true);
        expect(world.statics.length).toBeGreaterThan(20);
    });
});

describe('tavern world settle', () => {
    const hasWasm = wasmArtifactsPresent();
    // The plain unit run (build-js, no WASM) skips; the dedicated CI job sets
    // TAVERN_SEEDS and downloads the artifacts, so a miss there is an error.
    if (!hasWasm && process.env.CI && process.env.TAVERN_SEEDS) {
        it('has WASM artifacts in the tavern-world job', () => {
            throw new Error('public/wasm artifacts missing — CI must download them');
        });
    }

    it.skipIf(!hasWasm)(
        `${SEEDS} seeded rolls all settle within ${MAX_SIM_SECONDS} s of simulated time`,
        async () => {
            const failures: string[] = [];
            for (let k = 0; k < SEEDS; k++) {
                const seed = (0x5eed0000 + k * 7919) >>> 0;
                const expression = EXPRESSIONS[k % EXPRESSIONS.length]!;
                try {
                    const result = await rollHeadless(expression, seed, null, {
                        world,
                        dt: DT,
                        maxSteps: MAX_SIM_SECONDS / DT,
                    });
                    if (result.results.some((r) => !r.naturalValue)) {
                        failures.push(`${seed} ${expression}: a face read 0`);
                    }
                } catch (err) {
                    failures.push(`${seed} ${expression}: ${(err as Error).message}`);
                }
            }
            expect(failures).toEqual([]);
        },
        600_000
    );
});
