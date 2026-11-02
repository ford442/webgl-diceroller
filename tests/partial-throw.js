/**
 * Playwright smoke test: a throw can name its dice (needs real WASM physics).
 *
 *   A. A die parked in the jail is kinematic. R (a throw with no id list) moves
 *      every *other* die and leaves the held one exactly where it was; with
 *      nothing held, R throws the whole table again.
 *   B. A share link of a partial throw (`?ids=` — table slots, at v=3) opened
 *      twice settles the same faces on the same slots, and parks the dice it
 *      leaves out, so where a fresh spawn happened to leave them cannot matter.
 *
 * Prereq: npm run build:wasm && npm run build:js && npm run preview
 */
import { launchPage, waitForRollFinished } from './helpers/browser.js';
import { BASE } from './helpers/server.js';

const LAYOUT = 'layout-seed=1&density=med&theme=default';
const OPEN_URL = `${BASE}/?webgl&no-post&fair-dice&test&${LAYOUT}`;
// Six d6; slots 1 and 4 are thrown, 0/2/3/5 are parked in the jail.
const REPLAY_URL = `${BASE}/?webgl&no-post&fair-dice&test&seed=424242&v=3&dice=d6:6&ids=1,4&${LAYOUT}`;
const THROWN_SLOTS = [1, 4];
const LOAD_TIMEOUT_MS = 180000;
const SETTLE_TIMEOUT_MS = 180000;
const MOVED = 0.01;
const STILL = 1e-4;

function isBenignBrowserError(message) {
    return message.includes('404 (Not Found)') || message.includes('dice_physics.js');
}

async function open(page, url) {
    await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
    await page.waitForFunction(() => /** @type {any} */ (window).__app?.ready === true, null, {
        timeout: LOAD_TIMEOUT_MS,
    });
    if (
        !(await page.evaluate(() => /** @type {any} */ (window).__app.isWasmAvailable?.() === true))
    ) {
        throw new Error('WASM physics not available (run npm run build:wasm)');
    }
}

/** Positions of every die mesh, in scene order. */
function diePositions(page) {
    return page.evaluate(() => {
        const out = [];
        /** @type {any} */ (window).__app.scene.traverse((object) => {
            if (object.userData?.isDie) out.push(object.position.toArray());
        });
        return out;
    });
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

(async () => {
    const { browser, page, errors } = await launchPage();
    page.setDefaultTimeout(LOAD_TIMEOUT_MS);
    try {
        // ---- A. R never moves a held die --------------------------------
        await open(page, OPEN_URL);
        await page.evaluate(() => {
            for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
                const input = /** @type {HTMLInputElement} */ (
                    document.getElementById(`dice-count-${type}`)
                );
                input.value = type === 'd6' ? '4' : '0';
                input.dispatchEvent(new Event('change'));
            }
        });
        await page.keyboard.press('KeyR');
        await waitForRollFinished(page, { minFinished: 1, timeout: SETTLE_TIMEOUT_MS });

        const held = await page.evaluate(() => {
            const engine = /** @type {any} */ (window).__app.getWasmEngine();
            const ids = Array.from(engine.getDieIds(), (id) => Math.round(id)).slice(0, 2);
            /** @type {any} */ (window).__app.interactables.diceJail.hold(ids);
            return /** @type {any} */ (window).__app.interactables.diceJail.getState();
        });
        if (held.heldIds.length !== 2) {
            console.error(`FAIL: expected 2 held dice, got ${JSON.stringify(held)}`);
            process.exit(1);
        }
        // Let the parked poses reach the meshes before taking the reference.
        await page.waitForTimeout(1500);
        const before = await diePositions(page);

        await page.keyboard.press('KeyR');
        await waitForRollFinished(page, { minFinished: 2, timeout: SETTLE_TIMEOUT_MS });
        const after = await diePositions(page);

        const deltas = before.map((p, i) => distance(p, after[i]));
        const still = deltas.filter((d) => d < STILL).length;
        const moved = deltas.filter((d) => d > MOVED).length;
        if (before.length !== 4 || still !== 2 || moved !== 2) {
            console.error(
                `FAIL: R with 2 of 4 dice held should move 2 and leave 2 (moved=${moved}, still=${still}, deltas=${deltas.map((d) => d.toFixed(4))})`
            );
            process.exit(1);
        }
        console.log(
            '✓ R threw the two free dice and left the two held ones exactly where they were'
        );

        await page.evaluate(() =>
            /** @type {any} */ (window).__app.interactables.diceJail.release()
        );
        await page.waitForTimeout(1500);
        const beforeAll = await diePositions(page);
        await page.keyboard.press('KeyR');
        await waitForRollFinished(page, { minFinished: 3, timeout: SETTLE_TIMEOUT_MS });
        const afterAll = await diePositions(page);
        const movedAll = beforeAll.filter((p, i) => distance(p, afterAll[i]) > MOVED).length;
        if (movedAll !== 4) {
            console.error(`FAIL: R with nothing held should throw all 4 dice (moved ${movedAll})`);
            process.exit(1);
        }
        console.log('✓ with nothing held, R throws every die');

        // ---- B. a partial share link replays identically ----------------
        const runs = [];
        for (let run = 0; run < 2; run++) {
            await open(page, REPLAY_URL);
            await waitForRollFinished(page, { timeout: SETTLE_TIMEOUT_MS });
            runs.push(
                await page.evaluate(() => ({
                    values: /** @type {any} */ (window).__app
                        .readAllDiceValues()
                        .map((d) => d.value),
                    heldIds: /** @type {any} */ (window).__app.interactables.diceJail.getState()
                        .heldIds.length,
                    share: /** @type {any} */ (window).__app.getLastRollShareUrl?.() ?? null,
                }))
            );
        }
        console.log('Run A:', JSON.stringify(runs[0]));
        console.log('Run B:', JSON.stringify(runs[1]));

        for (const run of runs) {
            if (run.values.length !== 6) {
                console.error(`FAIL: expected 6 dice, got ${run.values.length}`);
                process.exit(1);
            }
            for (const slot of THROWN_SLOTS) {
                const value = run.values[slot];
                if (!(value >= 1 && value <= 6)) {
                    console.error(`FAIL: thrown slot ${slot} has no face (${value})`);
                    process.exit(1);
                }
            }
            if (run.heldIds !== 4) {
                console.error(
                    `FAIL: the 4 dice the link leaves out should be parked (${run.heldIds})`
                );
                process.exit(1);
            }
            const ids = run.share ? new URL(run.share).searchParams.get('ids') : null;
            if (ids !== '1,4') {
                console.error(`FAIL: the replayed throw should re-share as ids=1,4 (got ${ids})`);
                process.exit(1);
            }
        }
        if (JSON.stringify(runs[0].values) !== JSON.stringify(runs[1].values)) {
            console.error(
                'FAIL: the partial-throw link settled different faces on the second load'
            );
            process.exit(1);
        }
        console.log('✓ a partial-throw link settles the same faces on the same slots, twice');

        const fatal = errors.filter((message) => !isBenignBrowserError(message));
        if (fatal.length) {
            console.error('Browser errors:', fatal);
            process.exit(1);
        }
        console.log('PASS: partial throws');
        process.exit(0);
    } catch (err) {
        console.error('FAILURE:', err.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
