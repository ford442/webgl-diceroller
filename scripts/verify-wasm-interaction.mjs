#!/usr/bin/env node
/**
 * Interaction smoke test for the WASM-only dice path.
 *
 * Boots the built app on its default configuration (no escape-hatch flags) and
 * asserts that:
 *   1. WASM is authoritative and `physicsWorld === null` (no ammo world).
 *   2. No die carries an ammo rigid body.
 *   3. Drag holds the die kinematically in the WASM engine and moves it.
 *   4. Double-click levitation lifts the die and releases it with an impulse.
 *
 * Prereq: a build with `public/wasm/` present (`npm run build`).
 * Usage:   node scripts/verify-wasm-interaction.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 4178;
const BASE = `http://127.0.0.1:${PORT}`;
const PATH = '/?webgl&no-post&fair-dice&test';
const LOAD_TIMEOUT_MS = 240000;

async function startPreview() {
    const proc = spawn(
        'npx',
        ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    for (let i = 0; i < 120; i++) {
        await sleep(500);
        try {
            if ((await fetch(`${BASE}/`)).ok) return proc;
        } catch {
            // retry
        }
    }
    proc.kill('SIGKILL');
    throw new Error('preview server did not start');
}

let failed = 0;
function check(ok, okMessage, failMessage) {
    if (ok) {
        console.log(`ok: ${okMessage}`);
    } else {
        failed += 1;
        console.error(`FAIL: ${failMessage}`);
    }
    return ok;
}

const preview = await startPreview();

try {
    const browser = await chromium.launch({
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(LOAD_TIMEOUT_MS);

    await page.goto(`${BASE}${PATH}`, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
    await page.waitForFunction(() => window.__app?.ready === true, null, {
        timeout: LOAD_TIMEOUT_MS,
    });

    const backend = await page.evaluate(() => ({
        wasmAvailable: window.__app.physics?.isWasmAvailable?.() === true,
        physicsWorldIsNull: (window.__app.physicsWorld ?? null) === null,
        hasInteraction: typeof window.__app.interaction?.handleDown === 'function',
    }));

    if (!backend.wasmAvailable) {
        console.error(
            'FAIL: WASM physics unavailable — build public/wasm (`npm run build:wasm`) first'
        );
        failed += 1;
    } else {
        check(
            backend.physicsWorldIsNull,
            'default path runs with physicsWorld === null',
            'default path initialised an ammo dynamics world'
        );
        check(
            backend.hasInteraction,
            'interaction handlers are exposed for the smoke test',
            'app.interaction is not available (needs ?test build hooks)'
        );
    }

    if (failed === 0) {
        // Reduce to a single d6 so raycasts are unambiguous and settling is quick.
        await page.evaluate(() => {
            for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
                const input = document.getElementById(`dice-count-${type}`);
                if (!input) continue;
                input.value = type === 'd6' ? '1' : '0';
                input.dispatchEvent(new Event('change'));
            }
        });
        await page.waitForFunction(() => window.__app.dice?.areDiceSettled?.() === true, null, {
            timeout: 60000,
            polling: 100,
        });

        const bodies = await page.evaluate(() => {
            const dice = [];
            window.__app.scene.traverse((object) => {
                if (object.userData?.isDie) {
                    dice.push({ hasAmmoBody: object.userData.body != null });
                }
            });
            return dice;
        });
        check(
            bodies.length > 0 && bodies.every((d) => !d.hasAmmoBody),
            `no ammo rigid body on any of ${bodies.length} die mesh(es)`,
            `ammo rigid bodies present on ${bodies.filter((d) => d.hasAmmoBody).length} die mesh(es)`
        );

        // --- drag -----------------------------------------------------------
        const drag = await page.evaluate(async () => {
            const app = window.__app;
            const THREE = app.THREE;
            const engine = app.physics.getWasmEngine();
            const kinematicCalls = [];
            const original = engine.setDieKinematic?.bind(engine);
            if (typeof original !== 'function') {
                return { error: 'engine has no setDieKinematic' };
            }
            engine.setDieKinematic = (id, kinematic) => {
                kinematicCalls.push(kinematic);
                return original(id, kinematic);
            };

            let die = null;
            app.scene.traverse((object) => {
                if (!die && object.userData?.isDie) die = object;
            });
            if (!die) return { error: 'no die mesh in scene' };

            const project = (mesh) => {
                const ndc = new THREE.Vector3().copy(mesh.position).project(app.camera);
                return { x: ndc.x, y: ndc.y };
            };
            const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

            const start = die.position.clone();
            const grab = project(die);
            app.interaction.handleDown(grab.x, grab.y);
            await frame();

            // Sweep the pointer sideways across several frames.
            for (let i = 1; i <= 12; i++) {
                app.interaction.handleMove(grab.x + 0.02 * i, grab.y + 0.01 * i);
                await frame();
            }
            const held = die.position.clone();
            app.interaction.handleUp();
            for (let i = 0; i < 5; i++) await frame();

            engine.setDieKinematic = original;
            return {
                movedWhileHeld: held.distanceTo(start),
                kinematicCalls,
            };
        });

        if (drag.error) {
            failed += 1;
            console.error(`FAIL: drag smoke test could not run — ${drag.error}`);
        } else {
            check(
                drag.movedWhileHeld > 0.25,
                `drag moved the die ${drag.movedWhileHeld.toFixed(2)} units on WASM`,
                `drag barely moved the die (${drag.movedWhileHeld.toFixed(3)} units)`
            );
            check(
                drag.kinematicCalls[0] === true &&
                    drag.kinematicCalls[drag.kinematicCalls.length - 1] === false,
                'drag held the die kinematic in WASM and released it',
                `setDieKinematic sequence was ${JSON.stringify(drag.kinematicCalls)}`
            );
        }

        // --- levitation ------------------------------------------------------
        await page.waitForFunction(() => window.__app.dice?.areDiceSettled?.() === true, null, {
            timeout: 60000,
            polling: 100,
        });

        const levitation = await page.evaluate(async () => {
            const app = window.__app;
            const THREE = app.THREE;
            let die = null;
            app.scene.traverse((object) => {
                if (!die && object.userData?.isDie) die = object;
            });
            if (!die) return { error: 'no die mesh in scene' };

            const ndc = new THREE.Vector3().copy(die.position).project(app.camera);
            const startY = die.position.y;

            // Two clicks inside DOUBLE_CLICK_DELAY trigger levitation.
            app.interaction.handleDown(ndc.x, ndc.y);
            app.interaction.handleUp();
            app.interaction.handleDown(ndc.x, ndc.y);
            app.interaction.handleUp();

            let peakY = startY;
            const until = performance.now() + 1400;
            while (performance.now() < until) {
                await new Promise((resolve) => requestAnimationFrame(() => resolve()));
                peakY = Math.max(peakY, die.position.y);
            }
            return { startY, peakY, lift: peakY - startY };
        });

        if (levitation.error) {
            failed += 1;
            console.error(`FAIL: levitation smoke test could not run — ${levitation.error}`);
        } else {
            check(
                levitation.lift > 1.0,
                `levitation lifted the die ${levitation.lift.toFixed(2)} units on WASM`,
                `levitation lifted the die only ${levitation.lift.toFixed(3)} units`
            );
        }
    }

    await page.close();
    await browser.close();
} finally {
    preview.kill('SIGTERM');
}

if (failed > 0) {
    console.error(`\n${failed} WASM interaction check(s) failed`);
    process.exit(1);
}

console.log('\nAll WASM interaction checks passed.');
