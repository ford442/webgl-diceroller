// Verifies the Phase 4 worker-physics path end to end in a real browser:
// • PhysicsBridge selects the worker backend by default
// • the page is cross-origin isolated and uses the SharedArrayBuffer transport
// • addDie() returns ids synchronously (mirrored monotonic counter)
// • the worker self-paces its own loop: transforms advance under gravity
//   WITHOUT the main thread ever calling step()
// • high-frequency commands batch into one flush per frame (SAB ring or a
//   single postMessage) and torque impulses still affect the simulation
// • kinematic hold + release impulse path works through the worker command queue
// • the step timer parks with nothing to simulate, restarts on addDie, stops
//   ticking while the page is hidden, and resumes without replaying a backlog
// • a 4x slower wakeup timer (test hook) still settles a seeded throw in the
//   same wall time (< 10% apart) on the same faces: the worker steps by
//   elapsed time, so a late timer catches up instead of playing slow motion
//
// Mirrors scripts/verify-wasm-primitives.mjs.
import { chromium } from 'playwright';
import { startDev } from '../tests/helpers/server.js';
import { writeFile, rm } from 'node:fs/promises';

const PORT = 5197;
const TEST_MODULE = new URL('../src/__worker_phys_test.js', import.meta.url);

const TEST_SRC = `
import {
    loadWasmEngine, isWasmAvailable, getWasmEngine,
    isUsingWorkerPhysics, isUsingSharedArrayBuffer,
    flushWorkerCommandBatch, getWorkerPhysicsStats, setPhysicsHidden,
    seededPhysicsThrow, setPhysicsTimerScale, getSimClock,
} from './wasm/PhysicsBridge.js';
import { THROW_TABLE_SURFACE_Y, presetForShape } from 'dice-core/wasm/physicsPresets';
import { loadHullForDie } from './wasm/PhysicsBridge.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const yForId = (e, wantId) => {
    const ids = e.getDieIds();
    const xf = e.getTransforms();
    for (let i = 0; i < ids.length; i++) {
        if (Math.round(ids[i]) === wantId) return xf[i * 7 + 1];
    }
    return null;
};

const quatForId = (e, wantId) => {
    const ids = e.getDieIds();
    const xf = e.getTransforms();
    for (let i = 0; i < ids.length; i++) {
        if (Math.round(ids[i]) === wantId) {
            const b = i * 7;
            return [xf[b + 3], xf[b + 4], xf[b + 5], xf[b + 6]];
        }
    }
    return null;
};

const quatDelta = (a, b) => {
    if (!a || !b) return 0;
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]);
};

export async function run() {
    const ok = await loadWasmEngine();
    if (!ok || !isWasmAvailable()) return { ok: false, reason: 'physics not available' };

    const usingWorker = isUsingWorkerPhysics();
    const usingSAB = isUsingSharedArrayBuffer();
    const crossOriginIsolated = self.crossOriginIsolated === true;

    const e = getWasmEngine();
    e.init(-15.0, -2.75, 18.0, 18.0);
    flushWorkerCommandBatch();

    const id0 = e.addDie(6, 0, 8, 0);
    const id1 = e.addDie(6, 1, 9, 0);
    flushWorkerCommandBatch();
    const idsSync = (id0 === 0 && id1 === 1);

    // Gravity test (worker self-paced loop)
    let y0 = null;
    for (let i = 0; i < 40 && y0 === null; i++) {
        await new Promise(r => setTimeout(r, 25));
        y0 = yForId(e, id0);
    }
    const yStart = y0;
    await new Promise(r => setTimeout(r, 400));
    const yLater = yForId(e, id0);
    const countVisible = e.getDieCount();
    const fellUnderGravity = (yStart != null && yLater != null && yLater < yStart - 0.1);

    // --- batched torque + message-rate check --------------------------------
    getWorkerPhysicsStats(); // clear / snapshot baseline
    const qBefore = quatForId(e, id1);
    for (let frame = 0; frame < 24; frame++) {
        for (let d = 0; d < 8; d++) {
            e.applyTorqueImpulse(id1, 0.04, 0, 0.06);
        }
        flushWorkerCommandBatch();
        await new Promise(r => setTimeout(r, 20));
    }
    const qAfter = quatForId(e, id1);
    const torqueApplied = quatDelta(qBefore, qAfter) > 0.02;
    const stats = getWorkerPhysicsStats();
    // SAB path: zero batch postMessages in steady state; fallback: at most one
    // batch per flush (24 frames of 8 torques each), never one per command.
    const batchedTransport = usingSAB
        ? stats.batchMsgs === 0
        : stats.batchMsgs > 0 && stats.batchMsgs <= 24;

    // --- Drag scenario: kinematic hold + release impulse --------------------
    const dragId = e.addDie(6, 0, 6, 0);
    const hasKinematic = typeof e.setDieKinematic === 'function';
    let dragHeld = false;
    let dragMovedOnRelease = false;
    if (hasKinematic) {
        e.setDieKinematic(dragId, true);
        for (let i = 0; i < 20; i++) {
            e.setDieTransform(dragId, 2, 4, 1, 0, 0, 0, 1);
            // The app flushes once per frame (postRender); without it the
            // transforms sit in the batch until the next structural command.
            flushWorkerCommandBatch();
            await new Promise(r => setTimeout(r, 25));
        }
        const holdY = yForId(e, dragId);
        dragHeld = holdY != null && Math.abs(holdY - 4) < 0.35;
        e.setDieKinematic(dragId, false);
        e.applyImpulse(dragId, 0, -8, 0);
        await new Promise(r => setTimeout(r, 400));
        const afterY = yForId(e, dragId);
        dragMovedOnRelease = holdY != null && afterY != null && afterY < holdY - 0.15;
    }

    // --- Idle: the step timer parks with nothing to simulate ---------------
    // An empty world is asleep; the worker parks after IDLE_TICKS (0.25 s).
    e.clearAllDice();
    flushWorkerCommandBatch();
    await sleep(600);
    const idleWhenEmpty = getWorkerPhysicsStats().loopRunning === false;

    const idleId = e.addDie(6, 0, 8, 0);
    flushWorkerCommandBatch();
    await sleep(150);
    const runningAfterAdd = getWorkerPhysicsStats().loopRunning === true;

    // --- Hidden tab: no ticks while hidden, no backlog on resume -----------
    setPhysicsHidden(true);
    await sleep(150);
    const hiddenStats = getWorkerPhysicsStats();
    const pausedWhenHidden = hiddenStats.loopRunning === false;
    const ticksAtHide = hiddenStats.fixedTicks;
    await sleep(1000); // a backlog would be ~120 ticks
    const noTicksWhileHidden = getWorkerPhysicsStats().fixedTicks === ticksAtHide;
    setPhysicsHidden(false);
    await sleep(250); // ~30 ticks of real time
    const resumedStats = getWorkerPhysicsStats();
    const resumedTicks = resumedStats.fixedTicks - ticksAtHide;
    const resumedWithoutBacklog =
        resumedStats.loopRunning === true && resumedTicks > 0 && resumedTicks < 90;
    e.removeDie(idleId);

    // --- Throttled timer: same settle wall time, same faces ----------------
    const settleRun = async (scale) => {
        setPhysicsTimerScale(scale);
        // Hidden while spawning: every spawn/throw command lands before the
        // first tick, so both runs start from the same tick boundary.
        setPhysicsHidden(true);
        e.clearAllDice();
        const ids = ['d6', 'd20', 'd8'].map((shape, index) => {
            const sides = Number(shape.slice(1));
            const preset = presetForShape(shape);
            const id = e.addDie(sides, 0, THROW_TABLE_SURFACE_Y + 5.75 + index * 0.5, 0);
            e.setDieMaterial(id, preset.friction, preset.rollingFriction);
            e.setDieDrag(id, preset.dragFactor ?? 0);
            loadHullForDie(id, sides);
            return { id, index };
        });
        seededPhysicsThrow(4242, ids, THROW_TABLE_SURFACE_Y);
        flushWorkerCommandBatch();
        await sleep(100);
        const tick0 = getSimClock().stepIndex;
        const t0 = performance.now();
        setPhysicsHidden(false);
        await sleep(200); // let the throw leave the settled state
        while (!e.areAllSettled() && performance.now() - t0 < 30000) await sleep(5);
        const wallMs = performance.now() - t0;
        const faceIds = Array.from(e.getDieIds(), (v) => Math.round(v));
        const faceValues = Array.from(e.getFaceValues());
        const faces = ids.map(({ id }) => faceValues[faceIds.indexOf(id)] ?? 0);
        return { wallMs, faces, ticks: getSimClock().stepIndex - tick0 };
    };
    const normal = await settleRun(1);
    const throttled = await settleRun(4);
    setPhysicsTimerScale(1);
    e.clearAllDice();
    flushWorkerCommandBatch();
    const throttleWallRatio = throttled.wallMs / normal.wallMs;
    const throttleCatchesUp =
        normal.faces.every((f) => f > 0) &&
        JSON.stringify(normal.faces) === JSON.stringify(throttled.faces) &&
        Math.abs(throttleWallRatio - 1) < 0.1;

    return {
        ok: true,
        normalSettle: normal, throttledSettle: throttled, throttleWallRatio, throttleCatchesUp,
        idleWhenEmpty, runningAfterAdd, pausedWhenHidden, noTicksWhileHidden,
        resumedTicks, resumedWithoutBacklog,
        usingWorker, usingSAB, crossOriginIsolated,
        idsSync, id0, id1,
        countVisible,
        yStart, yLater, fellUnderGravity,
        torqueApplied, batchedTransport,
        workerMsgsPerSecond: stats.msgsPerSecond,
        batchRecords: stats.batchRecords,
        hasKinematic, dragHeld, dragMovedOnRelease,
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
    await page.goto(`${BASE}/src/wasm/staticColliders.ts?test`, { waitUntil: 'domcontentloaded' });
    result = await page.evaluate(async () => {
        try {
            // @ts-ignore — runtime-generated test module written just before this browser-side import runs.
            const m = await import('/src/__worker_phys_test.js');
            return await m.run();
        } catch (ex) {
            return { ok: false, reason: String((ex && ex.stack) || ex) };
        }
    });
    console.log('RESULT:', JSON.stringify(result, null, 2));
    console.log('ERRORS:', JSON.stringify(errors.slice(0, 5)));
} finally {
    await browser.close();
    await vite.close();
    await rm(TEST_MODULE, { force: true });
}

// Non-zero exit on logical failure so CI can gate on it — naming each check
// that failed, rather than one AND of all of them.
const checks = result
    ? {
          ok: result.ok,
          usingWorker: result.usingWorker,
          idsSync: result.idsSync,
          fellUnderGravity: result.fellUnderGravity,
          torqueApplied: result.torqueApplied,
          batchedTransport: result.batchedTransport,
          dragHeldAndReleased:
              !result.hasKinematic || (result.dragHeld && result.dragMovedOnRelease),
          idleWhenEmpty: result.idleWhenEmpty,
          runningAfterAdd: result.runningAfterAdd,
          pausedWhenHidden: result.pausedWhenHidden,
          noTicksWhileHidden: result.noTicksWhileHidden,
          resumedWithoutBacklog: result.resumedWithoutBacklog,
          throttleCatchesUp: result.throttleCatchesUp,
      }
    : { result: false };
const failed = Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([name]) => name);

if (failed.length) {
    console.error(`[verify] FAILED: ${failed.join(', ')}`);
    process.exit(1);
}
console.log('[verify] PASSED');
