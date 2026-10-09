/**
 * Playwright smoke test: a roll that never settles still ends (#341).
 *
 * `__app.physics.forceNoSettle(true)` makes the settle watch see every die as
 * awake. The roll must then finish as `timedOut` — not wait forever — with
 * the dice read as they lie in the results HUD and a re-roll button offered.
 * Clearing the hook, the next roll must settle normally (the timed-out roll
 * left nothing "in progress").
 *
 * Prereq: npm run build:wasm && npm run build:js && npm run preview
 */
const { launchPage, waitForRollFinished, settleDiagnostics } = require('./helpers/browser');
const { BASE } = require('./helpers/server');

const URL = `${BASE}/?webgl&no-post&fair-dice&test&layout-seed=1&density=med&theme=default`;
const LOAD_TIMEOUT_MS = 180000;
// 12 s of simulated time, or the 5 s stall guard once the worker parks —
// either way well inside this on a software-rendered runner.
const ROLL_TIMEOUT_MS = 180000;

(async () => {
    const { browser, page } = await launchPage();
    page.setDefaultTimeout(LOAD_TIMEOUT_MS);
    try {
        await page.goto(URL, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
        await page.waitForFunction(() => window.__app?.ready === true, null, {
            timeout: LOAD_TIMEOUT_MS,
        });
        if (!(await page.evaluate(() => window.__app.isWasmAvailable?.() === true))) {
            console.error('FAIL: WASM physics not available (run npm run build:wasm)');
            process.exit(1);
        }

        await page.evaluate(() => {
            for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
                const input = /** @type {HTMLInputElement | null} */ (
                    document.getElementById(`dice-count-${type}`)
                );
                if (!input) continue;
                input.value = type === 'd20' || type === 'd6' ? '1' : '0';
                input.dispatchEvent(new Event('change'));
            }
            window.__app.physics.forceNoSettle(true);
            window.__app.replayRoll(1234);
        });

        const timedOut = await waitForRollFinished(page, {
            timeout: ROLL_TIMEOUT_MS,
            allowTimedOut: true,
        });
        if (timedOut.phase !== 'timedOut') {
            console.error(`FAIL: expected the forced roll to time out, got ${timedOut.phase}`);
            process.exit(1);
        }
        console.log(`✓ forced roll ended as timedOut (${timedOut.lastTimeoutReason})`);

        const hud = await page.evaluate(() => ({
            results: /** @type {Array<{ value: number | null }>} */ (
                Array.isArray(window.__app.getRollState().lastResults)
                    ? window.__app.getRollState().lastResults
                    : []
            ),
            cards: document.querySelectorAll('.hud-result-card').length,
            reroll: !!document.querySelector('[data-testid="result-reroll"]'),
        }));
        if (hud.results.length !== 2 || hud.results.some((r) => r.value == null)) {
            console.error(
                `FAIL: timed-out roll has no readable result: ${JSON.stringify(hud.results)}`
            );
            process.exit(1);
        }
        if (hud.cards < 2 || !hud.reroll) {
            console.error(
                `FAIL: results HUD missing cards or re-roll button: ${JSON.stringify(hud)}`
            );
            process.exit(1);
        }
        console.log(`✓ HUD shows ${hud.cards} result cards and a re-roll button`);

        await page.evaluate(() => {
            window.__app.physics.forceNoSettle(false);
            window.__app.replayRoll(5678);
        });
        const settled = await waitForRollFinished(page, {
            minFinished: timedOut.settledCount + 1,
            timeout: ROLL_TIMEOUT_MS,
        });
        console.log(`✓ the next roll settled normally (${settled.phase})`);
        console.log('PASS: a roll that never settles still ends with a result');
        process.exit(0);
    } catch (err) {
        console.error('FAILURE:', err.message);
        console.error(await settleDiagnostics(page));
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
