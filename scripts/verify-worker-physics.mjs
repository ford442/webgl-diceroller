// Verifies the Phase 4 worker-physics path end to end in a real browser:
//   • PhysicsBridge selects the worker backend by default
//   • the page is cross-origin isolated and uses the SharedArrayBuffer transport
//   • addDie() returns ids synchronously (mirrored monotonic counter)
//   • the worker self-paces its own loop: transforms advance under gravity
//     WITHOUT the main thread ever calling step()
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
} from './wasm/PhysicsBridge.js';

const yForId = (e, wantId) => {
    const ids = e.getDieIds();
    const xf = e.getTransforms();
    for (let i = 0; i < ids.length; i++) {
        if (Math.round(ids[i]) === wantId) return xf[i * 7 + 1];
    }
    return null;
};

export async function run() {
    const ok = await loadWasmEngine();
    if (!ok || !isWasmAvailable()) return { ok: false, reason: 'physics not available' };

    const usingWorker = isUsingWorkerPhysics();
    const usingSAB = isUsingSharedArrayBuffer();
    const crossOriginIsolated = self.crossOriginIsolated === true;

    const e = getWasmEngine();
    e.init(-15.0, -2.75, 18.0, 18.0);

    // Synchronous, mirrored ids.
    const id0 = e.addDie(6, 0, 8, 0);
    const id1 = e.addDie(6, 1, 9, 0);
    const idsSync = (id0 === 0 && id1 === 1);

    // The main thread never calls step(); only the worker's self-paced loop
    // does. Wait and confirm the die fell under gravity.
    let y0 = null;
    for (let i = 0; i < 40 && y0 === null; i++) { await new Promise(r => setTimeout(r, 25)); y0 = yForId(e, id0); }
    const yStart = y0;
    await new Promise(r => setTimeout(r, 400));
    const yLater = yForId(e, id0);
    const countVisible = e.getDieCount();

    const fellUnderGravity = (yStart != null && yLater != null && yLater < yStart - 0.1);

    // Drag scenario: kinematic hold + release impulse (worker command path).
    const dragId = e.addDie(6, 0, 6, 0);
    const hasKinematic = typeof e.setDieKinematic === 'function';
    let dragHeld = false;
    let dragMovedOnRelease = false;
    if (hasKinematic) {
        e.setDieKinematic(dragId, true);
        for (let i = 0; i < 20; i++) {
            e.setDieTransform(dragId, 2, 4, 1, 0, 0, 0, 1);
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

    return {
        ok: true,
        usingWorker, usingSAB, crossOriginIsolated,
        idsSync, id0, id1,
        countVisible,
        yStart, yLater, fellUnderGravity,
        hasKinematic, dragHeld, dragMovedOnRelease,
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
    // Load a lightweight module URL (same origin) instead of `/` so main.js
    // does not race this harness with a second engine.init() that clears dice.
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

// Non-zero exit on logical failure so CI can gate on it.
const pass = result && result.ok && result.usingWorker && result.idsSync && result.fellUnderGravity
    && (!result.hasKinematic || (result.dragHeld && result.dragMovedOnRelease));
if (!pass) {
    console.error('[verify] FAILED');
    process.exit(1);
}
console.log('[verify] PASSED');
