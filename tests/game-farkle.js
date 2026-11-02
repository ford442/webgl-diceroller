/**
 * Playwright test: a solo Farkle game against the bot, played to an outcome on
 * the real table (needs real WASM physics).
 *
 * The person's seat is driven through `window.__app.game` exactly as the panel
 * buttons do (`submit` / `rethrow`); the bot plays through the same table. What
 * is asserted is what the table must do for the rules:
 *
 *   • the jail holds exactly the dice the rules state has set aside;
 *   • a throw moves only the free dice — held dice do not move by a hair;
 *   • every logged throw really moved dice (the bot's included);
 *   • the game ends with an outcome, whose scores are the rules' totals;
 *   • stopping the game puts the table back the way it was.
 *
 * Prereq: npm run build:wasm && npm run build:js && npm run preview
 */
import { launchPage } from './helpers/browser.js';
import { BASE } from './helpers/server.js';

const PAGE_URL = `${BASE}/?webgl&no-post&fair-dice&test&layout-seed=1&density=med&theme=default`;
const LOAD_TIMEOUT_MS = 180000;
const GAME_TIMEOUT_MS = 600000;
const POLL_MS = 100;
const MOVED = 0.01;
const STILL = 1e-4;
// A short game: the first seat to bank 400 starts the final round.
const GAME = { seed: 9001, config: { targetScore: 400, maxRounds: 6 } };

function isBenignBrowserError(message) {
    return message.includes('404 (Not Found)') || message.includes('dice_physics.js');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function diePositions(page) {
    return page.evaluate(() => {
        const out = [];
        /** @type {any} */ (window).__app.scene.traverse((object) => {
            if (object.userData?.isDie) out.push(object.position.toArray());
        });
        return out;
    });
}

function snapshot(page) {
    return page.evaluate(() => {
        const game = /** @type {any} */ (window).__app.game;
        const s = /** @type {any} */ (game?.getSnapshot());
        if (!s) return null;
        return {
            phase: s.phase,
            toAct: s.toAct,
            state: s.state,
            legal: s.legal,
            notice: s.notice,
            outcome: s.outcome,
            log: s.log.map((e) => ({ seat: e.seat, action: e.action, rolled: !!e.roll })),
            held: /** @type {any} */ (window).__app.interactables.diceJail.getState().heldIds
                .length,
            share: /** @type {any} */ (window).__app.getLastRollShareUrl?.() ?? null,
            started: /** @type {any} */ (window).__app.getRollState().startedCount,
        };
    });
}

/** What a sensible person does: take the most scoring dice, bank at 300. */
function chooseAction(snap) {
    const { state, legal } = snap;
    if (state.phase === 'roll') return { type: 'roll' };
    if (state.phase === 'keep') {
        const keeps = legal.filter((a) => a.type === 'keep');
        return keeps.reduce((best, a) => (a.dice.length > best.dice.length ? a : best));
    }
    return state.turnScore >= 300 ? { type: 'bank' } : { type: 'roll' };
}

(async () => {
    const { browser, page, errors } = await launchPage();
    page.setDefaultTimeout(LOAD_TIMEOUT_MS);
    const fail = (message) => {
        console.error(`FAIL: ${message}`);
        process.exit(1);
    };
    try {
        await page.goto(PAGE_URL, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
        await page.waitForFunction(() => /** @type {any} */ (window).__app?.ready === true, null, {
            timeout: LOAD_TIMEOUT_MS,
        });
        if (
            !(await page.evaluate(
                () => /** @type {any} */ (window).__app.isWasmAvailable?.() === true
            ))
        ) {
            fail('WASM physics not available (run npm run build:wasm)');
        }
        if (!(await page.evaluate(() => !!(/** @type {any} */ (window).__app.game)))) {
            fail('/** @type {any} */ (window).__app.game is missing although physics is available');
        }
        const tableBefore = await page.evaluate(() =>
            /** @type {any} */ (window).__app.readAllDiceValues().map((d) => d.type)
        );

        const started = await page.evaluate(
            (options) =>
                /** @type {any} */ (window).__app.game
                    .start({ ...options, pace: { think: 0, afterThrow: 0 } })
                    .then((session) => !!session),
            GAME
        );
        if (!started) fail('the game did not start');
        console.log('✓ Farkle started against the bot');

        const deadline = Date.now() + GAME_TIMEOUT_MS;
        let last = null;
        let sinceHumanBefore = null; // positions at the last "decide" screen
        let checkedHeldStill = 0;
        let sharedPartial = false;

        for (;;) {
            if (Date.now() > deadline) fail('the game did not finish in time');
            const snap = await snapshot(page);
            if (!snap) fail('the game vanished');
            if (snap.phase === 'stopped') fail(`the game stopped early: ${snap.notice}`);

            if (snap.phase === 'over') {
                last = snap;
                break;
            }
            if (snap.phase === 'cocked') {
                await page.evaluate(() => /** @type {any} */ (window).__app.game.rethrow());
                continue;
            }
            if (snap.phase !== 'your-turn' || snap.toAct !== 'you' || !snap.legal.length) {
                await sleep(POLL_MS);
                continue;
            }

            // The table is at rest and it is the person's decision: the jail
            // must hold exactly what the rules say is set aside.
            const kept = snap.state.dice.filter((d) => d.kept).length;
            if (snap.held !== kept) {
                fail(`jail holds ${snap.held} dice but the rules have set aside ${kept}`);
            }

            // The throw since the last decision moved only the free dice.
            if (sinceHumanBefore && sinceHumanBefore.logLen + 1 === snap.log.length) {
                const after = await diePositions(page);
                const free = 6 - sinceHumanBefore.kept;
                const moved = sinceHumanBefore.positions.filter(
                    (p, i) => distance(p, after[i]) > MOVED
                ).length;
                const still = sinceHumanBefore.positions.filter(
                    (p, i) => distance(p, after[i]) < STILL
                ).length;
                const lastEntry = snap.log[snap.log.length - 1];
                if (
                    lastEntry.seat === 'you' &&
                    lastEntry.action.type === 'roll' &&
                    sinceHumanBefore.kept > 0 &&
                    sinceHumanBefore.kept < 6 &&
                    snap.state.phase === 'keep'
                ) {
                    if (still < sinceHumanBefore.kept || moved < free) {
                        fail(
                            `a throw of ${free} free dice moved ${moved} and left ${still} still ` +
                                `(${sinceHumanBefore.kept} were held)`
                        );
                    }
                    checkedHeldStill += 1;
                    // The partial throw is shareable: its link names the dice it moved.
                    const ids = snap.share ? new URL(snap.share).searchParams.get('ids') : null;
                    if (ids && ids.split(',').length === free) sharedPartial = true;
                }
            }

            const action = chooseAction(snap);
            sinceHumanBefore = {
                logLen: snap.log.length,
                kept,
                positions: await diePositions(page),
            };
            const result = /** @type {any} */ (
                await page.evaluate((a) => /** @type {any} */ (window).__app.game.submit(a), action)
            );
            if (!result.ok) fail(`the table refused ${JSON.stringify(action)}: ${result.error}`);
        }

        const outcome = last.outcome;
        if (!outcome || !outcome.winners.length) fail('the game ended without an outcome');
        if (JSON.stringify(outcome.scores) !== JSON.stringify(last.state.scores)) {
            fail('the outcome scores are not the rules state totals');
        }
        console.log(`✓ game over: ${JSON.stringify(outcome)}`);

        const throws = last.log.filter((e) => e.rolled);
        const botThrows = throws.filter((e) => e.seat === 'bot');
        if (!botThrows.length) fail('the bot never threw');
        if (last.started < throws.length) {
            fail(`only ${last.started} rolls started for ${throws.length} logged throws`);
        }
        console.log(
            `✓ ${throws.length} throws (${botThrows.length} by the bot) each moved real dice`
        );
        if (checkedHeldStill === 0) {
            console.log('· no partial throw came up to check held dice (very short game)');
        } else {
            console.log(`✓ held dice stayed put through ${checkedHeldStill} partial throws`);
        }
        if (checkedHeldStill > 0 && !sharedPartial) {
            fail('a partial throw did not reach the share link as ?ids=');
        }

        await page.evaluate(() => /** @type {any} */ (window).__app.game.stop());
        const tableAfter = await page.evaluate(() => ({
            types: /** @type {any} */ (window).__app.readAllDiceValues().map((d) => d.type),
            held: /** @type {any} */ (window).__app.interactables.diceJail.getState().heldIds
                .length,
        }));
        if (tableAfter.held !== 0) fail('stopping the game left dice held in the jail');
        if (JSON.stringify(tableAfter.types) !== JSON.stringify(tableBefore)) {
            fail(`the table was not restored: ${tableAfter.types} vs ${tableBefore}`);
        }
        console.log('✓ stopping the game restored the table');

        const fatal = errors.filter((message) => !isBenignBrowserError(message));
        if (fatal.length) {
            console.error('Browser errors:', fatal);
            process.exit(1);
        }
        console.log('PASS: Farkle against the bot');
        process.exit(0);
    } catch (err) {
        console.error('FAILURE:', err.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
