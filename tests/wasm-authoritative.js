/**
 * Preview smoke: the default runtime must keep all frame systems active when
 * WASM is authoritative and Ammo therefore leaves physicsWorld null.
 *
 * Prereq: npm run build:js && npm run preview
 */
const { runTest } = require('./helpers/browser');

const BASE = 'http://localhost:4173';
const URL = `${BASE}/?webgl&no-post&test`;
const LOAD_TIMEOUT_MS = 180000;
const SETTLE_TIMEOUT_MS = 180000;
const ROLL_SEED = 0x5eed1234;

runTest(async (page, _errors) => {
    page.setDefaultTimeout(LOAD_TIMEOUT_MS);
    console.log(`Opening WASM-authoritative runtime: ${URL}`);
    await page.goto(URL, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
    await page.waitForFunction(() => window.__app?.ready === true, null, {
        timeout: LOAD_TIMEOUT_MS,
    });

    const backend = await page.evaluate(() => {
        let diceCount = 0;
        window.__app.scene.traverse((object) => {
            if (object.userData?.isDie) diceCount += 1;
        });
        return {
            wasmAvailable: window.__app.isWasmAvailable?.() === true,
            physicsWorldIsNull: window.__app.physicsWorld === null,
            diceCount,
        };
    });
    if (!backend.wasmAvailable) {
        console.error('FAIL: WASM physics is unavailable (build/download public/wasm first)');
        return false;
    }
    if (!backend.physicsWorldIsNull) {
        console.error('FAIL: authoritative WASM path unexpectedly initialized Ammo');
        return false;
    }
    if (backend.diceCount === 0) {
        console.error('FAIL: no dice meshes were available for the smoke test');
        return false;
    }
    console.log('✓ WASM is available with physicsWorld === null');

    await page.evaluate((seed) => {
        const testWindow = /** @type {any} */ (window);
        testWindow.__wasmAuthoritative = {
            collisions: 0,
            torqueSubmissions: 0,
            trackedDie: null,
        };
        window.__app.events.on('dice:collision', () => {
            testWindow.__wasmAuthoritative.collisions += 1;
        });

        const engine = window.__app.getWasmEngine();
        const applyTorqueImpulse = engine.applyTorqueImpulse.bind(engine);
        engine.applyTorqueImpulse = (...args) => {
            testWindow.__wasmAuthoritative.torqueSubmissions += 1;
            return applyTorqueImpulse(...args);
        };

        // Two dice keep settlement quick under SwiftShader while guaranteeing
        // contact events and still exercising transform sync, bias, and dragging.
        for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
            const input = /** @type {HTMLInputElement} */ (
                document.getElementById(`dice-count-${type}`)
            );
            input.value = type === 'd6' ? '2' : '0';
            input.dispatchEvent(new Event('change'));
        }
        let die = null;
        window.__app.scene.traverse((object) => {
            if (!die && object.userData?.isDie) die = object;
        });
        const trackedDie = /** @type {any} */ (die);
        if (!trackedDie) throw new Error('dice controls did not leave a d6 mesh in the scene');
        testWindow.__wasmAuthoritative.trackedDie = trackedDie.uuid;
        testWindow.__wasmAuthoritative.startY = trackedDie.position.y;
        window.__app.replayRoll(seed);
    }, ROLL_SEED);

    await page.waitForFunction(
        () => {
            const state = /** @type {any} */ (window).__wasmAuthoritative;
            const die = window.__app.scene.getObjectByProperty('uuid', state.trackedDie);
            if (!die) return false;
            state.minY = Math.min(state.minY ?? die.position.y, die.position.y);
            state.maxY = Math.max(state.maxY ?? die.position.y, die.position.y);
            return state.maxY - state.minY > 0.05;
        },
        null,
        { timeout: 15000, polling: 50 }
    );
    console.log('✓ a dice mesh followed changing WASM transforms across frames');

    await page.waitForFunction(
        () =>
            /** @type {any} */ (window).__wasmAuthoritative.collisions > 0 &&
            /** @type {any} */ (window).__wasmAuthoritative.torqueSubmissions > 0,
        null,
        { timeout: SETTLE_TIMEOUT_MS, polling: 100 }
    );
    const frameSignals = await page.evaluate(() => ({
        collisions: /** @type {any} */ (window).__wasmAuthoritative.collisions,
        torqueSubmissions: /** @type {any} */ (window).__wasmAuthoritative.torqueSubmissions,
    }));
    console.log(`✓ collision polling emitted ${frameSignals.collisions} app event(s)`);
    console.log(`✓ mass bias submitted ${frameSignals.torqueSubmissions} torque impulse(s)`);

    // Bias torque can keep the solver's strict sleeping flag false even after the
    // dice are visually at rest, so use a bounded multi-frame movement threshold.
    await page.waitForFunction(
        () => {
            const state = /** @type {any} */ (window).__wasmAuthoritative;
            const positions = [];
            window.__app.scene.traverse((object) => {
                if (object.userData?.isDie) positions.push(object.position.toArray());
            });
            if (!state.settlePositions || state.settlePositions.length !== positions.length) {
                state.settlePositions = positions;
                state.stableSamples = 0;
                return false;
            }
            const maxMovement = positions.reduce((max, position, index) => {
                const previous = state.settlePositions[index];
                return Math.max(
                    max,
                    Math.hypot(
                        position[0] - previous[0],
                        position[1] - previous[1],
                        position[2] - previous[2]
                    )
                );
            }, 0);
            state.settlePositions = positions;
            state.stableSamples = maxMovement < 0.01 ? state.stableSamples + 1 : 0;
            return state.stableSamples >= 20;
        },
        null,
        { timeout: SETTLE_TIMEOUT_MS, polling: 100 }
    );
    console.log('✓ dice reached the bounded multi-frame settlement threshold');

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
        testWindow.__wasmAuthoritative.grab = { uuid: die.uuid, start: start.toArray() };
        return { started: true, uuid: die.uuid, ndc: [ndc.x, ndc.y] };
    });
    if (!grab.started) {
        console.error(`FAIL: could not start interaction (${grab.reason})`);
        return false;
    }

    try {
        await page.waitForFunction(
            () => {
                const { uuid, start } = /** @type {any} */ (window).__wasmAuthoritative.grab;
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
    console.log('✓ exposed interaction handlers moved a held WASM die');

    console.log('PASS: WASM-authoritative frame systems remained active without Ammo');
    return true;
});
