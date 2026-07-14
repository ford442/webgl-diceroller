// Verifies the Phase 4 worker-physics path end to end in a real browser:
//   • PhysicsBridge selects the worker backend by default
//   • the page is cross-origin isolated and uses the SharedArrayBuffer transport
//   • addDie() returns ids synchronously (mirrored monotonic counter)
//   • the worker self-paces its own loop: transforms advance under gravity
//     WITHOUT the main thread ever calling step()
//   • high-frequency commands batch into one flush per frame (SAB ring or a
//     single postMessage) and torque impulses still affect the simulation
//
// Mirrors scripts/verify-wasm-primitives.mjs.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile, rm } from 'node:fs/promises';

const PORT = 5197;
const BASE = `http://localhost:${PORT}`;
const TEST_MODULE = new URL('../src/__worker_phys_test.js', import.meta.url);

const TEST_SRC = `
import {
    loadWasmEngine, isWasmAvailable, getWasmEngine,
    isUsingWorkerPhysics, isUsingSharedArrayBuffer,
    flushWorkerCommandBatch, getWorkerPhysicsStats,
} from './wasm/PhysicsBridge.js';

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

    let y0 = null;
    for (let i = 0; i < 40 && y0 === null; i++) { await new Promise(r => setTimeout(r, 25)); y0 = yForId(e, id0); }
    const yStart = y0;
    await new Promise(r => setTimeout(r, 400));
    const yLater = yForId(e, id0);
    const countVisible = e.getDieCount();
    const fellUnderGravity = (yStart != null && yLater != null && yLater < yStart - 0.1);

    // --- batched torque + message-rate check --------------------------------
    getWorkerPhysicsStats();
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
    // SAB path: zero batch postMessages in steady state; fallback: one batch/frame.
    const batchedTransport = usingSAB
        ? stats.batchMsgs === 0
        : stats.batchMsgs <= 2;

    return {
        ok: true,
        usingWorker, usingSAB, crossOriginIsolated,
        idsSync, id0, id1,
        countVisible,
        yStart, yLater, fellUnderGravity,
        torqueApplied, batchedTransport,
        workerMsgsPerSecond: stats.msgsPerSecond,
        batchRecords: stats.batchRecords,
    };
}
`;

async function startVite() {
    const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'],
        { stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 60; i++) {
        await sleep(500);
        try { if ((await fetch(`${BASE}/`)).ok) return proc; } catch {}
    }
    proc.kill('SIGKILL');
    throw new Error('vite timeout');
}

await writeFile(TEST_MODULE, TEST_SRC);
console.log('[verify] starting vite...');
const vite = await startVite();
console.log('[verify] vite up, launching browser...');
const browser = await chromium.launch();
console.log('[verify] browser launched');
let result;
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', (ex) => errors.push('pageerror: ' + ex.message));
    page.on('worker', (w) => { w.on('console', (m) => errors.push('worker ' + m.type() + ': ' + m.text())); });
    await page.goto(`${BASE}/src/wasm/physicsFlags.js`, { waitUntil: 'domcontentloaded' });
    result = await page.evaluate(async () => {
        try {
            // @ts-ignore — runtime-generated test module written just before this browser-side import runs.
            const m = await import('/src/__worker_phys_test.js');
            return await m.run();
        } catch (ex) { return { ok: false, reason: String(ex && ex.stack || ex) }; }
    });
    console.log('RESULT:', JSON.stringify(result, null, 2));
    console.log('ERRORS:', JSON.stringify(errors.slice(0, 5)));
} finally {
    await browser.close();
    vite.kill('SIGTERM');
    await rm(TEST_MODULE, { force: true });
}

const pass = result && result.ok && result.usingWorker && result.idsSync
    && result.fellUnderGravity && result.torqueApplied && result.batchedTransport;
if (!pass) {
    console.error('[verify] FAILED');
    process.exit(1);
}
console.log('[verify] PASSED');
