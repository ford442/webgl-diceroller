/**
 * Full-app gameplay smoke test on the default WASM-authoritative path
 * (physicsWorld === null, see #250). Unlike the isolated worker module
 * test (`verify:worker-replay`), this drives the real app UI/scene graph
 * and asserts the visible/audible effects users actually depend on:
 *
 *   1. Visual sync   — a die mesh's position.y changes across frames after a roll
 *   2. Interaction    — a raycast-driven pointer drag moves a held die
 *   3. Collision audio — a multi-die roll produces audible impacts (getStats().played > 0)
 *
 * Share-URL replay determinism is covered separately by `test:share-roll-replay`.
 *
 * Prereq: npm run build:js && npm run preview
 */
import { runTest } from './helpers/browser.js';

const BASE = 'http://localhost:4173';
const URL = `${BASE}/?webgl&no-post&fair-dice&test`;
const LOAD_TIMEOUT_MS = 180000;
const SETTLE_TIMEOUT_MS = 180000;
const ROLL_SEED = 0xc0ffee;

runTest(async (page, _errors) => {
    page.setDefaultTimeout(LOAD_TIMEOUT_MS);
    console.log(`Opening gameplay loop: ${URL}`);
    await page.goto(URL, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
    await page.waitForFunction(() => window.__app?.ready === true, null, {
        timeout: LOAD_TIMEOUT_MS,
    });

    const wasmAvailable = await page.evaluate(() => window.__app.isWasmAvailable?.() === true);
    if (!wasmAvailable) {
        console.error('FAIL: WASM physics is unavailable (build/download public/wasm first)');
        return false;
    }

    // Real (trusted) user gesture: unlocks the AudioContext the same way a
    // pointerdown/keydown would in a real browser session (autoplay policy).
    await page.keyboard.press('Space');

    const setup = await page.evaluate(() => {
        for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
            const input = /** @type {HTMLInputElement} */ (
                document.getElementById(`dice-count-${type}`)
            );
            input.value = type === 'd6' ? '4' : '0';
            input.dispatchEvent(new Event('change'));
        }
        let die = null;
        window.__app.scene.traverse((object) => {
            if (!die && object.userData?.isDie) die = object;
        });
        if (!die) return { ok: false };
        const testWindow = /** @type {any} */ (window);
        testWindow.__gameplayLoop = { trackedDie: die.uuid };
        return { ok: true };
    });
    if (!setup.ok) {
        console.error('FAIL: dice controls did not leave a die mesh in the scene');
        return false;
    }

    await page.evaluate((seed) => window.__app.replayRoll(seed), ROLL_SEED);

    // 1. Visual sync: the tracked die's mesh must actually move as physics steps.
    await page.waitForFunction(
        () => {
            const state = /** @type {any} */ (window).__gameplayLoop;
            const die = window.__app.scene.getObjectByProperty('uuid', state.trackedDie);
            if (!die) return false;
            state.minY = Math.min(state.minY ?? die.position.y, die.position.y);
            state.maxY = Math.max(state.maxY ?? die.position.y, die.position.y);
            return state.maxY - state.minY > 0.05;
        },
        null,
        { timeout: 15000, polling: 50 }
    );
    console.log('✓ die mesh position.y changed across animation frames after roll()');

    // 3. Collision audio: with 4 d6 in flight this roll must produce impacts.
    await page.waitForFunction(
        () => window.__app.audio?.getStats?.().played > 0,
        null,
        { timeout: SETTLE_TIMEOUT_MS, polling: 100 }
    );
    const audioStats = await page.evaluate(() => window.__app.audio.getStats());
    console.log(`✓ collision audio played ${audioStats.played} impact(s)`);

    await page.waitForFunction(
        () => {
            const settled = window.__app?.areDiceSettled;
            return typeof settled === 'function' && settled() === true;
        },
        null,
        { timeout: SETTLE_TIMEOUT_MS }
    );
    const values = await page.evaluate(() => window.__app.readAllDiceValues());
    if (!values.length) {
        console.error('FAILURE: expected dice values on the table after settlement');
        return false;
    }
    console.log(`✓ dice settled with values: ${JSON.stringify(values)}`);

    // 2. Interaction smoke: a raycast click-drag on a die must move it (drag state).
    const grab = await page.evaluate(() => {
        const app = window.__app;
        const testWindow = /** @type {any} */ (window);
        const camera = app.camera;
        camera.updateMatrixWorld(true);

        const dice = [];
        app.scene.traverse((object) => {
            if (object.userData?.isDie) dice.push(object);
        });
        const candidates = dice
            .map((die) => {
                const ndc = die.getWorldPosition(new app.THREE.Vector3()).project(camera);
                return { die, ndc, score: ndc.x * ndc.x + ndc.y * ndc.y };
            })
            .filter(({ ndc }) => Math.abs(ndc.x) < 0.9 && Math.abs(ndc.y) < 0.9 && ndc.z < 1)
            .sort((a, b) => a.score - b.score);
        if (candidates.length === 0) return { started: false, reason: 'no projected die' };

        const { die, ndc } = candidates[0];
        const start = die.position.clone();
        app.interaction.handleDown(ndc.x, ndc.y);
        app.interaction.handleMove(Math.min(0.85, ndc.x + 0.2), ndc.y);
        testWindow.__gameplayLoop.grab = { uuid: die.uuid, start: start.toArray() };
        return { started: true };
    });
    if (!grab.started) {
        console.error(`FAIL: could not start interaction (${grab.reason})`);
        return false;
    }

    try {
        await page.waitForFunction(
            () => {
                const { uuid, start } = /** @type {any} */ (window).__gameplayLoop.grab;
                const die = window.__app.scene.getObjectByProperty('uuid', uuid);
                return (
                    die && die.position.distanceTo(new window.__app.THREE.Vector3(...start)) > 0.05
                );
            },
            null,
            { timeout: 10000, polling: 50 }
        );
    } finally {
        await page.evaluate(() => window.__app.interaction.handleUp());
    }
    console.log('✓ raycast pointer drag moved a held die (interaction reachable)');

    console.log('PASS: WASM gameplay loop — visual sync, interaction, and collision audio all fired');
    return true;
});
