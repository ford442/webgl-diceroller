/**
 * Playwright smoke test: the roll theatre (scrub, slow replay, crit cam).
 *
 *   1. Rolls until a die lands a natural max or min, and checks the crit cam
 *      took the table (slow replay running) and that skipping it still leaves
 *      the results HUD.
 *   2. Seeking the settled roll to tick N twice gives identical transforms
 *      (read from `__app.seekRoll`, never a screenshot), and seeking to the
 *      end of the timeline lands on the settled pose.
 *   3. Playing at ¼× and then "live" returns the table to the settled pose,
 *      and the next roll settles normally.
 *   4. A seek while a throw is in flight is refused.
 *
 * Prereq: npm run build:wasm && npm run build:js && npm run preview
 */
import { launchPage, waitForRollFinished, settleDiagnostics } from './helpers/browser.js';
import { BASE } from './helpers/server.js';

const URL = `${BASE}/?webgl&no-post&test&layout-seed=1&density=med&theme=default`;
const LOAD_TIMEOUT_MS = 180000;
const ROLL_TIMEOUT_MS = 180000;
const MAX_CRIT_TRIES = 12;
const SEEK_TICK = 90;
const PLAYBACK_TIMEOUT_MS = 120000;

function fail(message) {
    throw new Error(message);
}

function sameNumbers(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

(async () => {
    const { browser, page } = await launchPage();
    page.setDefaultTimeout(LOAD_TIMEOUT_MS);
    try {
        await page.goto(URL, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
        await page.waitForFunction(() => window.__app?.ready === true, null, {
            timeout: LOAD_TIMEOUT_MS,
        });
        if (!(await page.evaluate(() => window.__app.isWasmAvailable?.() === true))) {
            fail('WASM physics not available (run npm run build:wasm)');
        }
        if (!(await page.evaluate(() => !!window.__app.theatre))) {
            fail('window.__app.theatre is missing');
        }

        await page.evaluate(() => {
            for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
                const input = /** @type {HTMLInputElement | null} */ (
                    document.getElementById(`dice-count-${type}`)
                );
                if (!input) continue;
                input.value = type === 'd20' || type === 'd6' || type === 'd8' ? '1' : '0';
                input.dispatchEvent(new Event('change'));
            }
        });

        // --- 1. crit cam -------------------------------------------------------
        let finished = 0;
        let critSeen = false;
        for (let k = 0; k < MAX_CRIT_TRIES && !critSeen; k++) {
            // 9002 lands d6=1 on this layout; later seeds are a fallback if the table moves.
            const seed = 9002 + k;
            await page.evaluate((s) => window.__app.replayRoll(s), seed);
            const state = await waitForRollFinished(page, {
                minFinished: finished + 1,
                timeout: ROLL_TIMEOUT_MS,
            });
            finished = state.settledCount;
            const results = state.lastResults ?? [];
            const sides = (t) => Number(String(t).slice(1));
            const natural = results.some(
                (r) => !r.cocked && (r.value === 1 || r.value === sides(r.type))
            );
            if (!natural) continue;
            // The camera asks for the crit replay once its focus fly-to ends.
            await page.waitForFunction(
                () =>
                    window.__app.theatre.getState().crit === true &&
                    window.__app.theatre.getState().playing === true,
                null,
                {
                    timeout: 20000,
                    polling: 50,
                }
            );
            critSeen = true;
            const s = await page.evaluate(() => window.__app.theatre.getState());
            if (s.rate !== 0.25) fail(`crit replay rate ${s.rate}, expected 0.25`);
            console.log(
                `✓ seed ${seed} rolled ${JSON.stringify(results.map((r) => `${r.type}=${r.value}`))}: crit cam replaying at ¼×`
            );
            await page.evaluate(() => window.__app.theatre.skip());
            await page.waitForFunction(() => !window.__app.theatre.getState().crit, null, {
                timeout: 10000,
            });
            const cards = await page.evaluate(
                () => document.querySelectorAll('.hud-result-card').length
            );
            if (cards < 3) fail(`results HUD has ${cards} cards after skipping the crit cam`);
            console.log(`✓ skipping the crit cam leaves the results HUD (${cards} cards)`);
        }
        if (!critSeen) fail(`no natural max/min in ${MAX_CRIT_TRIES} rolls`);

        // A crit cam on a non-crit roll would have flipped this.
        await page.evaluate(() => window.__app.theatre.live());

        // --- 2. seek twice -----------------------------------------------------
        const settled = await page.evaluate(() =>
            Array.from(window.__app.getWasmEngine().getTransforms())
        );
        const a = await page.evaluate((t) => window.__app.seekRoll(t), SEEK_TICK);
        const b = await page.evaluate((t) => window.__app.seekRoll(t), SEEK_TICK);
        if (!a || !b)
            fail(
                `seek refused: ${JSON.stringify(await page.evaluate(() => window.__app.theatre.getState()))}`
            );
        if (a.tick !== SEEK_TICK || b.tick !== SEEK_TICK) fail(`seek ticks ${a.tick}/${b.tick}`);
        if (!sameNumbers(a.transforms, b.transforms)) fail('two seeks to the same tick differ');
        if (sameNumbers(a.transforms, settled))
            fail(`tick ${SEEK_TICK} is already the settled pose`);
        console.log(
            `✓ seeking to tick ${SEEK_TICK} twice gives identical transforms (${a.ids.length} dice)`
        );

        const { endTick } = await page.evaluate(() => window.__app.theatre.getState());
        const end = await page.evaluate((t) => window.__app.seekRoll(t), endTick);
        if (!end || !sameNumbers(end.transforms, settled)) {
            fail(`seeking to the settle (tick ${endTick}) does not land on the settled pose`);
        }
        console.log(`✓ seeking to the settle (tick ${endTick}) reproduces the settled pose`);

        // --- 3. play at ¼× and 1×, then live ----------------------------------
        // Playback advances per rendered frame, and a software-rendered runner
        // can take seconds per frame: wait on ticks moving, not on a wall time.
        await page.evaluate(() => window.__app.theatre.play(0.25, { from: 0 }));
        await page.waitForFunction(() => window.__app.theatre.getState().tick > 0, null, {
            timeout: PLAYBACK_TIMEOUT_MS,
        });
        const slow = await page.evaluate(() => window.__app.theatre.getState());
        if (slow.rate !== 0.25) fail(`slow playback rate ${slow.rate}`);
        await page.evaluate(() => window.__app.theatre.play(1));
        await page.waitForFunction(
            (from) => window.__app.theatre.getState().tick > from,
            slow.tick,
            { timeout: PLAYBACK_TIMEOUT_MS }
        );
        await page.evaluate(() => window.__app.theatre.live());
        await page.waitForFunction(() => !window.__app.theatre.getState().active, null, {
            timeout: 10000,
        });
        // The worker publishes the restored world with the exit's response.
        await page.waitForTimeout(250);
        const afterLive = await page.evaluate(() =>
            Array.from(window.__app.getWasmEngine().getTransforms())
        );
        if (!sameNumbers(afterLive, settled)) fail('"live" did not return the settled pose');
        console.log('✓ play at ¼× / 1× then "live" returns the table to the settled pose');

        // --- 4. refused mid-roll; the live loop still runs --------------------
        const midRoll = await page.evaluate(async () => {
            window.__app.replayRoll(31337);
            return window.__app.seekRoll(30);
        });
        if (midRoll !== null) fail('a seek during an in-progress throw was not refused');
        console.log('✓ a seek during an in-progress throw is refused');
        await waitForRollFinished(page, { minFinished: finished + 1, timeout: ROLL_TIMEOUT_MS });
        console.log('✓ the next roll settles normally');

        console.log('PASS: roll theatre');
        process.exit(0);
    } catch (err) {
        console.error('FAILURE:', err.message);
        console.error(await settleDiagnostics(page));
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
