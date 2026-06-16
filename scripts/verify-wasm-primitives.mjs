// Confirms the compiled WASM engine exposes the kinematic-control primitives
// that the ?wasm-drag interaction path relies on, and that a setTransform +
// setVelocity + step + read round-trips without throwing.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile, rm } from 'node:fs/promises';

const PORT = 5196;
const BASE = `http://localhost:${PORT}`;
const TEST_MODULE = new URL('../src/__wasm_prim_test.js', import.meta.url);

const TEST_SRC = `
import {
    loadWasmEngine, isWasmAvailable, getWasmEngine
} from './wasm/WasmPhysicsBridge.js';
export async function run() {
    const ok = await loadWasmEngine();
    if (!ok || !isWasmAvailable()) return { ok: false, reason: 'WASM not available' };
    const e = getWasmEngine();
    const methods = ['addDie','setDieTransform','setDieVelocity','applyImpulse',
        'applyTorqueImpulse','getTransforms','getDieIds','getCollisionEvents','step'];
    const missing = methods.filter((m) => typeof e[m] !== 'function');
    if (missing.length) return { ok: false, reason: 'missing methods: ' + missing.join(',') };

    // getTransforms() is a zero-copy view into WASM heap, so snapshot scalars
    // immediately rather than holding the array reference.
    const pos = () => { const t = e.getTransforms(); return { x: t[0], y: t[1], z: t[2] }; };

    const id = e.addDie(6, 0, 5, 0);

    // Mimics the ?wasm-drag control approach exactly:
    // 1) Kinematic hold via setDieTransform each frame (wakes + pins position).
    for (let i = 0; i < 30; i++) {
        e.setDieTransform(id, 1, 3, 2, 0, 0, 0, 1);
        e.step(1 / 60);
    }
    const hold = pos();
    const heldAtTarget = Math.abs(hold.x - 1) < 0.3 && Math.abs(hold.y - 3) < 0.3;

    // 2) Release toss via applyImpulse (wakes + imparts motion). Step several
    //    frames as happens in reality (one step is sleep-edge sensitive).
    e.applyImpulse(id, 12, 0, 0);
    e.applyTorqueImpulse(id, 0, 8, 0);
    for (let i = 0; i < 10; i++) e.step(1 / 60);
    const rel = pos();
    const movedOnRelease = rel.x > hold.x + 0.05;

    return { ok: true, heldAtTarget, hold, afterRelease: rel, movedOnRelease };
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
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    // The bridge reads window.location.search; load a clean URL.
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const result = await page.evaluate(async () => {
        try {
            const m = await import('/src/__wasm_prim_test.js');
            return await m.run();
        } catch (e) { return { ok: false, reason: String(e && e.stack || e) }; }
    });
    console.log('RESULT:', JSON.stringify(result));
    console.log('ERRORS:', JSON.stringify(errors.slice(0, 5)));
} finally {
    await browser.close();
    vite.kill('SIGTERM');
    await rm(TEST_MODULE, { force: true });
}
