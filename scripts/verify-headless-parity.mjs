// Golden roll vectors: packages/dice-core/golden/rolls.json is the contract
// dice-core publishes (#315) — "(expression, seed) on the tavern table settles
// to these faces". This harness is its browser half; the Node half is
// packages/dice-core/test/goldens.wasm.test.ts.
//
//   npm run verify:headless-parity   assert the file in a real browser
//   npm run goldens:update           regenerate it (browser-generated)
//
// In the page, for every vector and for both engine builds (wasm/, and
// wasm-scalar/), rollHeadless() runs against fetchAssetSource() and the
// recorded tavern world: faces, tick count and final state hash must match.
// Plain throws (no reroll/explode/opposed) are also rolled through the app's
// physics *worker* — spawn + seededPhysicsThrow on the same world — and must
// settle to the same faces. --write refuses to write a file the worker
// disagrees with.
//
// Mirrors scripts/verify-worker-replay.mjs.
import { chromium } from 'playwright';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDev } from '../tests/helpers/server.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = path.join(REPO_ROOT, 'packages/dice-core/golden/rolls.json');
const PORT = 5199;
const TEST_MODULE = new URL('../src/__headless_parity_test.js', import.meta.url);
const WRITE = process.argv.includes('--write');

/**
 * The vectors: every die shape alone and mixed, big pools, keep/drop, reroll,
 * exploding (engine ids keep growing across rounds), percentile, fudge,
 * modifiers and opposed rolls. Seeds are arbitrary but fixed.
 */
const CASES = [
    ...['1d4', '1d6', '1d8', '1d10', '1d12', '1d20'].flatMap((expr) => [
        { expr, seed: 1 },
        { expr, seed: 0x9e3779b9 },
    ]),
    { expr: '1d100', seed: 7 },
    { expr: 'd%', seed: 0xdeadbeef },
    { expr: '1d4+1d6+1d8+1d10+1d12+1d20', seed: 42 },
    { expr: '1d4+1d6+1d8+1d10+1d12+1d20', seed: 777 },
    { expr: '1d4+1d6+1d8+1d10+1d12+1d20', seed: 0x5eed0001 },
    { expr: '4d6', seed: 777 },
    { expr: '4d6', seed: 31337 },
    { expr: '2d20', seed: 5 },
    { expr: '2d20', seed: 0xcafef00d },
    { expr: '3d8+2d10', seed: 99 },
    { expr: '3d8+2d10', seed: 2024 },
    { expr: '2d6+1d10', seed: 11 },
    { expr: '1d20+1d12+1d10+1d8', seed: 123456 },
    { expr: '3d6+2d20', seed: 8 },
    { expr: '1d20+1d6', seed: 1 },
    { expr: '10d6', seed: 4 },
    { expr: '10d6', seed: 0x12345678 },
    { expr: '8d8', seed: 64 },
    { expr: '6d12', seed: 612 },
    { expr: '4d6kh3', seed: 3 },
    { expr: '4d6kh3', seed: 0xabcdef },
    { expr: '2d20kl1', seed: 20 },
    { expr: '2d20kh1', seed: 21 },
    { expr: '4d6r1', seed: 3 },
    { expr: '4d6r1', seed: 0x777 },
    { expr: '6d6!', seed: 11 },
    { expr: '6d6!', seed: 0x600d },
    { expr: '4d10!', seed: 10 },
    { expr: '4dF', seed: 44 },
    { expr: '1d20+5', seed: 15 },
    { expr: '3d6-2', seed: 36 },
    { expr: '1d20 vs 1d20', seed: 9 },
    { expr: '1d20 vs 1d20', seed: 0xfeedface },
    { expr: '2d6 vs 2d6', seed: 26 },
];

const TEST_SRC = `
import { rollHeadless } from 'dice-core/rollHeadless';
import { fetchAssetSource } from 'dice-core/assets/AssetSource';
import { applyWorld } from 'dice-core/wasm/WorldRecorder';
import { buildSpawnSpecsForGroups, parseNotation } from 'dice-core/roll/Notation';
import { DIE_TYPE_CATALOG } from 'dice-core/dice/DiceSetFormat';
import { getDieSides, presetForShape, THROW_TABLE_SURFACE_Y } from 'dice-core/wasm/physicsPresets';
import world from 'dice-core/fixtures/tavern-world.json';
import {
    loadWasmEngine, getWasmEngine, isUsingWorkerPhysics, loadHullForDie,
    seededPhysicsThrow, flushWorkerCommandBatch,
} from './wasm/PhysicsBridge.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function headless(cases, preferredDir) {
    const assets = fetchAssetSource();
    const out = [];
    for (const { expr, seed } of cases) {
        try {
            const r = await rollHeadless(expr, seed, null, { assets, world, preferredDir });
            out.push({
                expr, seed,
                faces: r.trace.faceValues,
                ...(r.trace.opposedFaceValues ? { opposedFaces: r.trace.opposedFaceValues } : {}),
                fixedTicks: r.trace.fixedTicks,
                stateHash: r.trace.stateHash,
                rounds: r.trace.rounds,
                solverBuildId: r.trace.solverBuildId,
            });
        } catch (err) {
            out.push({ expr, seed, error: String(err && err.message || err) });
        }
    }
    return out;
}

/** A plain throw through the app's worker, spawned exactly as rollHeadless does. */
export async function viaWorker(cases) {
    if (!(await loadWasmEngine())) return { error: 'physics not available' };
    if (!isUsingWorkerPhysics()) return { error: 'worker backend not selected' };
    const e = getWasmEngine();
    const out = [];
    for (const { expr, seed } of cases) {
        e.reset();
        const w = world.init;
        e.init(w.gravity, w.tableY, w.tableHalfW, w.tableHalfD);
        applyWorld(e, world);
        const specs = buildSpawnSpecsForGroups(parseNotation(expr).groups);
        const dice = specs.map((spec, index) => {
            const shape = DIE_TYPE_CATALOG[spec.type]?.shape ?? 'd6';
            const sides = getDieSides(shape);
            const preset = presetForShape(shape);
            const id = e.addDie(sides, 0, THROW_TABLE_SURFACE_Y + 5.75 + index * 0.5, 0);
            e.setDieMaterial(id, preset.friction, preset.rollingFriction);
            e.setDieDrag(id, preset.dragFactor ?? 0);
            loadHullForDie(id, sides);
            return { id, index };
        });
        seededPhysicsThrow(seed >>> 0, dice, THROW_TABLE_SURFACE_Y);
        flushWorkerCommandBatch();
        await sleep(300);
        const t0 = performance.now();
        let settledFor = 0;
        while (settledFor < 150 && performance.now() - t0 < 30000) {
            settledFor = e.areAllSettled() ? settledFor + 10 : 0;
            await sleep(10);
        }
        const ids = Array.from(e.getDieIds(), (v) => Math.round(v));
        const values = Array.from(e.getFaceValues());
        out.push({ expr, seed, faces: dice.map(({ id }) => values[ids.indexOf(id)] ?? 0) });
    }
    return out;
}
`;

/** Plain throws: one round, one side — what a single seededPhysicsThrow covers. */
function isPlainThrow(expr) {
    return !/[!rkF%]|vs|d100/.test(expr);
}

function sameVector(a, b, keys) {
    return keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

await writeFile(TEST_MODULE, TEST_SRC);
const vite = await startDev({ port: PORT });
const browser = await chromium.launch();
const failures = [];
let simd;
let scalar;
let worker;
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (ex) => errors.push('pageerror: ' + ex.message));
    // A same-origin URL that is not the app (see verify-worker-physics).
    await page.goto(`${vite.base}/src/wasm/staticColliders.ts?test`, {
        waitUntil: 'domcontentloaded',
    });
    const run = (fn, ...args) =>
        page.evaluate(
            async ([fn, args]) => {
                // @ts-ignore — written just before this browser-side import runs.
                const m = await import('/src/__headless_parity_test.js');
                return m[fn](...args);
            },
            [fn, args]
        );
    const plain = CASES.filter((c) => isPlainThrow(c.expr)).slice(0, 14);
    console.log(`[parity] rollHeadless in page: ${CASES.length} vectors x 2 builds…`);
    simd = await run('headless', CASES, 'wasm');
    scalar = await run('headless', CASES, 'wasm-scalar');
    console.log(`[parity] app worker: ${plain.length} plain throws…`);
    worker = await run('viaWorker', plain);
    if (errors.length) failures.push(...errors);
} finally {
    await browser.close();
    await vite.close();
    await rm(TEST_MODULE, { force: true });
}

const KEYS = ['faces', 'opposedFaces', 'fixedTicks', 'stateHash'];
for (let i = 0; i < CASES.length; i++) {
    const a = simd[i];
    const b = scalar[i];
    const label = `${a.expr} seed ${a.seed}`;
    if (a.error || b.error) failures.push(`${label}: ${a.error ?? b.error}`);
    else if (!sameVector(a, b, KEYS)) failures.push(`${label}: SIMD and scalar builds differ`);
    else if (a.faces.some((f) => !f) || a.opposedFaces?.some((f) => !f)) {
        failures.push(`${label}: a face read 0 ${JSON.stringify(a.faces)}`);
    }
}
if (worker?.error) failures.push(`worker: ${worker.error}`);
else {
    const before = failures.length;
    for (const w of worker) {
        const h = simd.find((v) => v.expr === w.expr && v.seed === w.seed);
        if (JSON.stringify(h?.faces) !== JSON.stringify(w.faces)) {
            failures.push(
                `${w.expr} seed ${w.seed}: worker ${JSON.stringify(w.faces)} != rollHeadless ${JSON.stringify(h?.faces)}`
            );
        }
    }
    const disagreed = failures.length - before;
    console.log(
        `[parity] worker agreed on ${worker.length - disagreed}/${worker.length} plain throws`
    );
}

const vectors = simd.map(({ expr, seed, faces, opposedFaces, fixedTicks, stateHash }) => ({
    expr,
    seed,
    faces,
    ...(opposedFaces ? { opposedFaces } : {}),
    fixedTicks,
    stateHash,
}));
const buildInfo = JSON.parse(
    await readFile(path.join(REPO_ROOT, 'public/wasm/build-info.json'), 'utf8')
);

if (WRITE) {
    if (failures.length) {
        console.error('[parity] not writing goldens:\n  ' + failures.join('\n  '));
        process.exit(1);
    }
    const golden = {
        schema: 1,
        description:
            'dice-core roll goldens: rollHeadless(expr, seed, null, { world: fixtures/tavern-world.json }) ' +
            'settles to these faces. Generated in a browser by scripts/verify-headless-parity.mjs --write; ' +
            'asserted in Node by packages/dice-core/test/goldens.wasm.test.ts.',
        solverRevision: buildInfo.solver_revision,
        solverBuildId: simd[0]?.solverBuildId ?? null,
        emccVersion: buildInfo.emcc_version,
        world: 'fixtures/tavern-world.json',
        vectors,
    };
    await writeFile(GOLDEN, JSON.stringify(golden, null, 4) + '\n');
    console.log(`[parity] wrote ${vectors.length} vectors to ${path.relative(REPO_ROOT, GOLDEN)}`);
    process.exit(0);
}

const golden = JSON.parse(await readFile(GOLDEN, 'utf8'));
if (golden.solverRevision !== buildInfo.solver_revision) {
    failures.push(
        `golden solverRevision ${golden.solverRevision} != engine ${buildInfo.solver_revision}: ` +
            'the solver changed — regenerate with `npm run goldens:update`'
    );
} else {
    for (const want of golden.vectors) {
        const got = vectors.find((v) => v.expr === want.expr && v.seed === want.seed);
        if (!got || !sameVector(got, want, KEYS)) {
            failures.push(
                `${want.expr} seed ${want.seed}: browser ${JSON.stringify(got)} != golden ${JSON.stringify(want)}`
            );
        }
    }
}

if (failures.length) {
    console.error('[parity] FAILED:\n  ' + failures.join('\n  '));
    process.exit(1);
}
console.log(`[parity] PASSED: ${golden.vectors.length} golden vectors in the browser, both builds`);
