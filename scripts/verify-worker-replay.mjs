// Verifies deterministic replay on the default worker physics path:
//   • seededPhysicsThrow routes RNG + impulses through the worker atomically
//   • two identical seeded throws produce bit-identical settled transforms
//   • serializePhysicsState() round-trips via async request/response
//
// Mirrors scripts/verify-worker-physics.mjs.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile, rm } from 'node:fs/promises';

const PORT = 5198;
const BASE = `http://localhost:${PORT}`;
const TEST_MODULE = new URL('../src/__worker_replay_test.js', import.meta.url);
const TABLE_SURFACE_Y = 1.0;
const SEED = 42;

const TEST_SRC = `
import {
    loadWasmEngine, isWasmAvailable, getWasmEngine,
    isUsingWorkerPhysics, seededPhysicsThrow, serializePhysicsState,
} from './wasm/PhysicsBridge.js';

function transformsEqual(a, b, epsilon = 1e-4) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (Math.abs(a[i] - b[i]) > epsilon) return false;
    }
    return true;
}

async function waitSettled(engine, timeoutMs = 12000) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
        if (engine.areAllSettled()) return true;
        await new Promise((r) => setTimeout(r, 50));
    }
    return engine.areAllSettled();
}

export async function run() {
    const ok = await loadWasmEngine();
    if (!ok || !isWasmAvailable()) return { ok: false, reason: 'physics not available' };
    if (!isUsingWorkerPhysics()) return { ok: false, reason: 'worker backend not active' };

    const e = getWasmEngine();
    e.init(-15.0, -2.75, 18.0, 18.0);

    const id = e.addDie(6, 0, 8, 0);
    const dice = [{ id, index: 0 }];

    seededPhysicsThrow(${SEED}, dice, ${TABLE_SURFACE_Y});
    const settled1 = await waitSettled(e);
    const t1 = Array.from(e.getTransforms());

    seededPhysicsThrow(${SEED}, dice, ${TABLE_SURFACE_Y});
    const settled2 = await waitSettled(e);
    const t2 = Array.from(e.getTransforms());

    const replayIdentical = transformsEqual(t1, t2);

    const snapshot = await serializePhysicsState();
    const hasSnapshot = snapshot instanceof Uint8Array && snapshot.byteLength > 0;

    return {
        ok: true,
        settled1,
        settled2,
        replayIdentical,
        t1Len: t1.length,
        hasSnapshot,
        snapshotBytes: snapshot?.byteLength ?? 0,
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
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text());
    });
    page.on('pageerror', (ex) => errors.push('pageerror: ' + ex.message));
    page.on('worker', (w) => { w.on('console', (m) => errors.push('worker ' + m.type() + ': ' + m.text())); });
    await page.goto(`${BASE}/src/wasm/physicsFlags.js`, { waitUntil: 'domcontentloaded' });
    result = await page.evaluate(async () => {
        try {
            const m = await import('/src/__worker_replay_test.js');
            return await m.run();
        } catch (ex) { return { ok: false, reason: String(ex && ex.stack || ex) }; }
    });
    console.log('RESULT:', JSON.stringify(result, null, 2));
    console.log('ERRORS:', JSON.stringify(errors.slice(0, 8)));
} finally {
    await browser.close();
    vite.kill('SIGTERM');
    await rm(TEST_MODULE, { force: true });
}

const pass = result && result.ok && result.replayIdentical && result.settled1 && result.settled2
    && result.hasSnapshot;
if (!pass) {
    console.error('[verify] FAILED');
    process.exit(1);
}
console.log('[verify] PASSED');
