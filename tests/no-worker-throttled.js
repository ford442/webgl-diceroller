/**
 * Playwright smoke test: the main-thread physics bridge finishes a roll on a
 * slow CPU (#364).
 *
 * `?no-worker` steps the engine from the render loop. On a slow frame it used
 * to run at most 10 fixed ticks and drop the rest, so on SwiftShader a roll
 * reached the 30 s wall backstop with the dice still in the air. The bridge
 * now pays a frame's owed ticks within a wall budget, carries the rest, and
 * the settle watch does not count wall time while the engine is behind — so a
 * throttled roll is slower, but it settles (`timedOut === false`).
 *
 * The CPU is throttled 6× (Chrome DevTools `Emulation.setCPUThrottlingRate`)
 * after the tavern has loaded, for the roll only.
 *
 * Prereq: npm run build:wasm && npm run build:js && npm run preview
 */
import { launchPage, waitForRollFinished, settleDiagnostics } from './helpers/browser.js';
import { BASE } from './helpers/server.js';

const URL = `${BASE}/?webgl&no-post&no-worker&fair-dice&test&layout-seed=1&density=med&theme=default`;
const LOAD_TIMEOUT_MS = 180000;
// A throttled software-rendered roll is slow by design; the point is that it
// finishes as `settled`, not how quickly.
const ROLL_TIMEOUT_MS = 480000;
const CPU_THROTTLE = 6;

(async () => {
    const { browser, page } = await launchPage();
    page.setDefaultTimeout(LOAD_TIMEOUT_MS);
    try {
        await page.goto(URL, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
        await page.waitForFunction(() => window.__app?.ready === true, null, {
            timeout: LOAD_TIMEOUT_MS,
        });
        const backend = await page.evaluate(() => ({
            wasm: window.__app.isWasmAvailable?.() === true,
            behindHook: typeof window.__app.physics?.behind === 'function',
        }));
        if (!backend.wasm) {
            console.error('FAIL: WASM physics not available (run npm run build:wasm)');
            process.exit(1);
        }
        if (!backend.behindHook) {
            console.error('FAIL: __app.physics.behind() missing');
            process.exit(1);
        }

        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
        console.log(`CPU throttled ${CPU_THROTTLE}×`);

        await page.evaluate(() => {
            for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
                const input = /** @type {HTMLInputElement | null} */ (
                    document.getElementById(`dice-count-${type}`)
                );
                if (!input) continue;
                input.value = type === 'd20' || type === 'd6' ? '1' : '0';
                input.dispatchEvent(new Event('change'));
            }
            // Sample the clock while the roll runs: proof the slow path was hit.
            const w = /** @type {any} */ (window);
            w.__behindSeen = false;
            w.__behindTimer = setInterval(() => {
                if (window.__app.physics.behind?.()) w.__behindSeen = true;
            }, 50);
            window.__app.replayRoll(1234);
        });

        const started = Date.now();
        const state = await waitForRollFinished(page, {
            timeout: ROLL_TIMEOUT_MS,
            allowTimedOut: true,
        });
        const wallS = ((Date.now() - started) / 1000).toFixed(1);
        const behindSeen = await page.evaluate(() => {
            const w = /** @type {any} */ (window);
            clearInterval(w.__behindTimer);
            return w.__behindSeen === true;
        });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

        console.log(
            `roll finished as ${state.phase} after ${wallS} s wall` +
                ` (clock fell behind: ${behindSeen ? 'yes' : 'no'})`
        );
        if (state.phase !== 'settled') {
            console.error(`FAIL: throttled ?no-worker roll timed out (${state.lastTimeoutReason})`);
            console.error(await settleDiagnostics(page));
            process.exit(1);
        }
        const results = Array.isArray(state.lastResults) ? state.lastResults : [];
        if (results.length !== 2 || results.some((r) => r.value == null || r.cocked)) {
            console.error(`FAIL: settled roll has unreadable faces: ${JSON.stringify(results)}`);
            process.exit(1);
        }
        console.log(`✓ faces ${results.map((r) => r.value).join(', ')}`);
        console.log('PASS: ?no-worker finishes a roll on a throttled CPU with timedOut=false');
        process.exit(0);
    } catch (err) {
        console.error('FAILURE:', err.message);
        console.error(await settleDiagnostics(page));
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
