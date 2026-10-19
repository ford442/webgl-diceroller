/**
 * Golden roll vectors: `(expression, seed, world) → faces`. One module, three
 * consumers, so Node and the browser can only ever disagree about the engine:
 *
 *   packages/dice-core/test/rollGoldens.test.ts   Node asserts the file.
 *   scripts/verify-headless-parity.mjs            Chromium asserts the file
 *                                                 (or rewrites it, --update).
 *   npm run golden:rolls                          Node rewrites the file.
 *
 * tests/golden/rolls.json is the contract an embedding of dice-core (#315)
 * publishes. It moves only with the solver: regenerate it when
 * SOLVER_REVISION bumps (the test refuses a file from another revision) or
 * when tests/fixtures/tavern-world.json is re-exported.
 */
import { rollHeadless, type AssetSource } from 'dice-core';
import type { WorldFixture } from 'dice-core/wasm/WorldRecorder';

export type GoldenWorld = 'plane' | 'tavern';

export interface GoldenCase {
    expression: string;
    seed: number;
    world: GoldenWorld;
}

export interface GoldenRecord extends GoldenCase {
    /** Natural (engine) face per left-side die, in result order. */
    faces: number[];
    /** Face after the default dice set's mapping (dF → -1/0/1, d100 → tens…). */
    values: number[];
    /** Values of the opposed side's dice, or null. */
    opposed: number[] | null;
    total: number;
    /** Fixed engine ticks until every round settled. */
    steps: number;
}

export interface GoldenFile {
    version: 1;
    /** SOLVER_REVISION the vectors were produced with (build-info.json). */
    solverRevision: number;
    dt: number;
    /** Who wrote the file: `node` (npm run golden:rolls) or `chromium`. */
    generatedBy: string;
    vectors: GoldenRecord[];
}

const PLANE: [string, number][] = [
    // One of every hull…
    ['1d4', 1],
    ['1d6', 2],
    ['1d8', 3],
    ['1d10', 4],
    ['1d12', 5],
    ['1d20', 6],
    // …and every derived face sequence on top of them.
    ['1d2', 7],
    ['1d3', 8],
    ['1d5', 9],
    ['4dF', 10],
    ['1d100', 11],
    ['1d%', 12],
    // Multi-die rolls: the readout that used to give dice 1..n a 0.
    ['4d6', 777],
    ['2d20', 5],
    ['1d20+1d6', 3],
    ['3d8+2d10', 99],
    ['4d4', 13],
    ['2d12', 14],
    ['6d6', 15],
    ['1d4+1d6+1d8+1d10+1d12+1d20', 16],
    ['10d6', 17],
    ['3d20', 18],
    ['5d10', 19],
    ['2d8+3', 20],
    ['1d20+7', 21],
    // Keep / drop / explode / reroll take extra physics rounds.
    ['4d6kh3', 22],
    ['4d6dl1', 23],
    ['2d20kh1', 24],
    ['2d20kl1', 25],
    ['4d6dh1', 26],
    ['3d6!', 27],
    ['2d6!!', 28],
    ['4d6r1', 29],
    ['8d6r2', 30],
    ['2d10!', 31],
    // Opposed rolls step both sides.
    ['1d20+5 vs 1d20+2', 32],
    ['2d6 vs 1d12', 33],
    // Seed spread on one expression.
    ['1d20', 0],
    ['1d20', 0xffffffff],
    ['1d20', 0x9e3779b9],
    ['3d6', 1234567],
    ['3d6', 7654321],
    ['2d20', 0xdeadbeef],
    ['1d6+1d8', 424242],
];

const TAVERN: [string, number][] = [
    ['1d20', 101],
    ['1d20+1d6', 102],
    ['1d4+1d8+1d12', 103],
    ['2d6+1d10', 104],
    ['3d6+2d20', 105],
    ['4dF', 106],
];

export const GOLDEN_CASES: GoldenCase[] = [
    ...PLANE.map(([expression, seed]) => ({ expression, seed, world: 'plane' as const })),
    ...TAVERN.map(([expression, seed]) => ({ expression, seed, world: 'tavern' as const })),
];

export const GOLDEN_DT = 1 / 120;

export async function runGoldenCase(
    c: GoldenCase,
    deps: { assets?: AssetSource; tavernWorld: WorldFixture }
): Promise<GoldenRecord> {
    const result = await rollHeadless(c.expression, c.seed, null, {
        assets: deps.assets,
        dt: GOLDEN_DT,
        world: c.world === 'tavern' ? deps.tavernWorld : undefined,
    });
    return {
        ...c,
        faces: result.results.map((r) => r.naturalValue),
        values: result.results.map((r) => r.value),
        opposed: result.evaluated.opposed?.dice.map((d) => d.value ?? 0) ?? null,
        total: result.total,
        steps: result.trace.steps,
    };
}

/** Field-by-field mismatches between two golden records ('' when equal). */
export function diffGolden(want: GoldenRecord, got: GoldenRecord): string {
    const fields = ['faces', 'values', 'opposed', 'total', 'steps'] as const;
    const bad = fields.filter((k) => JSON.stringify(want[k]) !== JSON.stringify(got[k]));
    if (!bad.length) return '';
    const key = `${want.expression} @ ${want.seed} (${want.world})`;
    return `${key}: ${bad
        .map((k) => `${k} want ${JSON.stringify(want[k])} got ${JSON.stringify(got[k])}`)
        .join('; ')}`;
}
