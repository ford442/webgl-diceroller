// Verifies that every caller of the engine integrates the same way (one
// fixed 1/120 s clock inside DicePhysicsEngine::step):
//   • seededPhysicsThrow routes RNG + impulses through the worker atomically,
//     and two identical seeded throws settle to the same transforms
//   • the in-process (?no-worker) engine stepped with 60 Hz and 30 Hz frame
//     deltas lands on byte-identical states for the same tick count — for the
//     fixture seed and for a spread of seeds, with the pipping bias ON
//   • worker, in-process and rollHeadless() settle the fixture throw to the
//     same faces
//   • serializePhysicsState() round-trips via async request/response
//
// Mirrors scripts/verify-worker-physics.mjs.
import { chromium } from 'playwright';
import { startDev } from '../tests/helpers/server.js';
import { writeFile, rm } from 'node:fs/promises';

const PORT = 5198;
const TEST_MODULE = new URL('../src/__worker_replay_test.js', import.meta.url);
const SEED = 42;
// Same dice, same order as rollHeadless(EXPRESSION): spawnSpecs walks groups.
const EXPRESSION = '1d6+1d20';
const SHAPES = ['d6', 'd20'];
// 20 simulated seconds; a multiple of 4 so 30 Hz frames (4 ticks each) and
// 60 Hz frames (2 ticks each) stop on the same tick.
const RUN_TICKS = 2400;
const HISTOGRAM_SEEDS = 20;

const TEST_SRC = `
import {
    loadWasmEngine, isWasmAvailable, getWasmEngine, loadHullForDie,
    isUsingWorkerPhysics, seededPhysicsThrow, serializePhysicsState,
} from './wasm/PhysicsBridge.js';
import { createInProcessPhysicsSession } from './core-engine/wasm/WasmPhysicsBridge.js';
import {
    applyThrowParams, computeSeededThrowParams, createSeededRng,
} from './core-engine/wasm/seededThrowParams.js';
import {
    PHYSICS_GRAVITY, PHYSICS_TABLE_HALF, PHYSICS_TABLE_Y, THROW_TABLE_SURFACE_Y,
    getDieSides, presetForShape,
} from './core-engine/wasm/physicsPresets.js';

const SHAPES = ${JSON.stringify(SHAPES)};

function transformsEqual(a, b, epsilon = 1e-4) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (Math.abs(a[i] - b[i]) > epsilon) return false;
    }
    return true;
}

function fnv1a64(bytes) {
    let h = 14695981039346656037n;
    for (const b of bytes) {
        h ^= BigInt(b);
        h = (h * 1099511628211n) & 0xffffffffffffffffn;
    }
    return '0x' + h.toString(16);
}

async function waitSettled(engine, timeoutMs = 20000) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
        if (engine.areAllSettled()) return true;
        await new Promise((r) => setTimeout(r, 50));
    }
    return engine.areAllSettled();
}

/** Spawn exactly what rollHeadless's spawnSpecs does. */
function spawn(engine, loadHull) {
    engine.clearAllDice();
    return SHAPES.map((shape, index) => {
        const sides = getDieSides(shape);
        const preset = presetForShape(shape);
        const id = engine.addDie(sides, 0, THROW_TABLE_SURFACE_Y + 5.75 + index * 0.5, 0);
        engine.setDieMaterial(id, preset.friction, preset.rollingFriction);
        engine.setDieDrag(id, preset.dragFactor ?? 0);
        loadHull(id, sides);
        return { id, index };
    });
}

/** In-process (?no-worker) throw, stepped with a fixed frame delta. */
function inProcessRun(session, seed, frameDt, ticks) {
    const e = session.engine;
    e.init(PHYSICS_GRAVITY, PHYSICS_TABLE_Y, PHYSICS_TABLE_HALF, PHYSICS_TABLE_HALF);
    const dice = spawn(e, session.loadHullForDie);
    applyThrowParams(e, computeSeededThrowParams(createSeededRng(seed), dice, THROW_TABLE_SURFACE_Y));
    const t0 = e.getFixedTickCount();
    while (e.getFixedTickCount() - t0 < ticks) e.step(frameDt);
    return {
        ticks: e.getFixedTickCount() - t0,
        settled: e.areAllSettled(),
        faces: Array.from(e.getFaceValues()),
        hash: fnv1a64(e.serializeState()),
    };
}

export async function run(seed, runTicks, histogramSeeds) {
    const ok = await loadWasmEngine();
    if (!ok || !isWasmAvailable()) return { ok: false, reason: 'physics not available' };
    if (!isUsingWorkerPhysics()) return { ok: false, reason: 'worker backend not active' };

    // --- worker ------------------------------------------------------------
    const e = getWasmEngine();
    e.init(PHYSICS_GRAVITY, PHYSICS_TABLE_Y, PHYSICS_TABLE_HALF, PHYSICS_TABLE_HALF);
    const dice = spawn(e, loadHullForDie);

    seededPhysicsThrow(seed, dice, THROW_TABLE_SURFACE_Y);
    const settled1 = await waitSettled(e);
    const t1 = Array.from(e.getTransforms());
    const workerFaces = Array.from(e.getFaceValues?.() ?? []);

    seededPhysicsThrow(seed, dice, THROW_TABLE_SURFACE_Y);
    const settled2 = await waitSettled(e);
    const t2 = Array.from(e.getTransforms());

    const snapshot = await serializePhysicsState();

    // --- in-process, 60 Hz vs 30 Hz frames ---------------------------------
    const session = await createInProcessPhysicsSession({ searchParams: new URLSearchParams() });
    if (!session.available) return { ok: false, reason: 'in-process engine not available' };
    const at60 = inProcessRun(session, seed, 1 / 60, runTicks);
    const at30 = inProcessRun(session, seed, 1 / 30, runTicks);

    const histogram = [];
    for (let i = 1; i <= histogramSeeds; i++) {
        const s = (seed + i * 7919) >>> 0;
        const a = inProcessRun(session, s, 1 / 60, runTicks);
        const b = inProcessRun(session, s, 1 / 30, runTicks);
        histogram.push({ seed: s, faces60: a.faces, faces30: b.faces, sameState: a.hash === b.hash, settled: a.settled && b.settled });
    }

    return {
        ok: true,
        settled1,
        settled2,
        replayIdentical: transformsEqual(t1, t2),
        hasSnapshot: snapshot instanceof Uint8Array && snapshot.byteLength > 0,
        workerFaces,
        at60,
        at30,
        histogram,
    };
}
`;

await writeFile(TEST_MODULE, TEST_SRC);
console.log('[verify] starting vite...');
const vite = await startDev({ port: PORT });
const BASE = vite.base;
console.log('[verify] vite up, launching browser...');
const browser = await chromium.launch();
console.log('[verify] browser launched');
let result;
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text());
    });
    page.on('pageerror', (ex) => errors.push('pageerror: ' + ex.message));
    page.on('worker', (w) => {
        w.on('console', (m) => errors.push('worker ' + m.type() + ': ' + m.text()));
    });
    // Any same-origin URL that is *not* the app: the module is served as a
    // plain script. (A missing path falls back to index.html and boots the
    // whole tavern in this page, which re-inits the shared physics bridge.)
    await page.goto(`${BASE}/src/core-engine/wasm/physicsFlags.ts`, {
        waitUntil: 'domcontentloaded',
    });
    result = await page.evaluate(
        async ({ seed, runTicks, histogramSeeds }) => {
            try {
                const m = await import('/src/__worker_replay_test.js');
                return await m.run(seed, runTicks, histogramSeeds);
            } catch (ex) {
                return { ok: false, reason: String((ex && ex.stack) || ex) };
            }
        },
        { seed: SEED, runTicks: RUN_TICKS, histogramSeeds: HISTOGRAM_SEEDS }
    );
    console.log('RESULT:', JSON.stringify(result, null, 2));
    console.log(
        'ERRORS:',
        JSON.stringify(errors.filter((e) => !e.startsWith('warning')).slice(0, 20))
    );
} finally {
    await browser.close();
    await vite.close();
    await rm(TEST_MODULE, { force: true });
}

const failures = [];
const sameFaces = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const allNonZero = (faces) => faces.length === SHAPES.length && faces.every((v) => v > 0);

if (!result?.ok) failures.push(`run failed: ${result?.reason}`);
else {
    if (!result.settled1 || !result.settled2) failures.push('worker throw did not settle');
    if (!result.replayIdentical) failures.push('worker replay of the same seed diverged');
    if (!result.hasSnapshot) failures.push('serializePhysicsState() returned nothing');
    if (!allNonZero(result.workerFaces)) failures.push('worker faces incomplete');

    const { at60, at30 } = result;
    if (at60.ticks !== RUN_TICKS || at30.ticks !== RUN_TICKS) {
        failures.push(`tick counts ${at60.ticks}/${at30.ticks} != ${RUN_TICKS}`);
    }
    if (!at60.settled || !at30.settled) failures.push('in-process throw did not settle');
    if (at60.hash !== at30.hash) {
        failures.push(`in-process state at 60 Hz (${at60.hash}) != 30 Hz (${at30.hash})`);
    }
    if (!sameFaces(at60.faces, result.workerFaces)) {
        failures.push(
            `in-process faces ${JSON.stringify(at60.faces)} != worker ${JSON.stringify(result.workerFaces)}`
        );
    }

    const drift = result.histogram.filter((h) => !h.sameState || !sameFaces(h.faces60, h.faces30));
    const unsettled = result.histogram.filter((h) => !h.settled);
    if (drift.length)
        failures.push(`30 Hz vs 60 Hz diverged for seeds ${drift.map((h) => h.seed)}`);
    if (unsettled.length) failures.push(`unsettled seeds ${unsettled.map((h) => h.seed)}`);
    const tally = {};
    for (const h of result.histogram)
        tally[JSON.stringify(h.faces60)] = (tally[JSON.stringify(h.faces60)] ?? 0) + 1;
    console.log('[verify] 60 Hz face histogram (== 30 Hz):', JSON.stringify(tally));
}

const { rollHeadless, wasmArtifactsPresent } = await import('../src/core-engine/rollHeadless.ts');
if (result?.ok && wasmArtifactsPresent()) {
    console.log(`[verify] comparing with rollHeadless('${EXPRESSION}', ${SEED})…`);
    const headless = await rollHeadless(EXPRESSION, SEED);
    const headlessFaces = headless.trace.faceValues ?? [];
    console.log(
        '[verify] faces — worker',
        JSON.stringify(result.workerFaces),
        'in-process',
        JSON.stringify(result.at60.faces),
        'headless',
        JSON.stringify(headlessFaces),
        'solverBuildId',
        headless.trace.solverBuildId
    );
    if (!sameFaces(headlessFaces, result.workerFaces)) {
        failures.push('rollHeadless faces diverge from the worker path');
    }
    // The faces above only mean something against a known solver build.
    if (!/^[1-9]\d*:[0-9a-f]+$/.test(headless.trace.solverBuildId ?? '')) {
        failures.push(`rollHeadless solverBuildId is ${headless.trace.solverBuildId}`);
    }
} else if (result?.ok) {
    console.log('[verify] skipping rollHeadless compare (WASM artifacts not present)');
}

if (failures.length) {
    console.error('[verify] FAILED:\n  ' + failures.join('\n  '));
    process.exit(1);
}
console.log('[verify] PASSED');
