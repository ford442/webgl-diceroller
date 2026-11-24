/**
 * Edge cases (#383): the browser conditions a release has to survive, each
 * either asserted here or documented as a decision in docs/EDGE_CASES.md.
 *
 *   npm run build:js:allow-missing-wasm && npm run preview
 *   npm run test:edge-cases                 # cases that need the dice report SKIP without WASM
 *   REQUIRE_WASM=1 npm run test:edge-cases  # ...and FAIL instead (the full-build CI job)
 *
 * Every case loads a fresh page with a small viewport (SwiftShader pays per pixel),
 * and fails on any uncaught error, error banner or unexpected console error.
 */
import { chromium } from 'playwright';
import { url } from './helpers/server.js';

const REQUIRE_WASM = process.env.REQUIRE_WASM === '1';
const READY_TIMEOUT_MS = 180000;
const BASE_QUERY = 'webgl&no-post&test';
const VIEWPORT = { width: 360, height: 270 };

const ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
];

let failed = 0;
let skipped = 0;
const check = (cond, label, extra = '') => {
    console.log(`  ${cond ? 'ok' : 'FAIL'}: ${label}${!cond && extra ? `  (${extra})` : ''}`);
    if (!cond) failed += 1;
};
const skip = (label) => {
    skipped += 1;
    console.log(`  SKIP: ${label}`);
};

const browser = await chromium.launch({
    headless: true,
    args: ARGS,
    executablePath: process.env.PW_CHROMIUM_PATH,
});

/** Noise that every no-WASM tavern run produces and that is not what a case is about. */
const EXPECTED_NOISE =
    /Failed to load resource|dice_physics|wasm-scalar|wasm\/|GL Driver Message|Physics engine unavailable|WASM module unavailable|Worker backend unavailable|Worker init failed/i;

/**
 * Open a page for one case. `init` runs before any app code (to break an API),
 * `ctx` options go to the browser context (offline, permissions, ...).
 * @param {string} name
 * @param {{ query?: string, init?: (() => void) | null, viewport?: { width: number, height: number }, context?: object, waitReady?: boolean }} [options]
 */
async function openCase(
    name,
    { query = BASE_QUERY, init, viewport = VIEWPORT, context = {}, waitReady = true } = {}
) {
    console.log(`\n# ${name}`);
    const ctx = await browser.newContext({ viewport, ...context });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
        if (m.type() === 'error' && !EXPECTED_NOISE.test(m.text()))
            problems.push(`console: ${m.text()}`);
    });
    if (init) await page.addInitScript(init);
    const goto = (q = query) => page.goto(url(`/?${q}`), { waitUntil: 'load', timeout: 120000 });
    await goto();
    if (waitReady) await ready(page);
    return {
        ctx,
        page,
        problems,
        goto,
        async close() {
            await ctx.close();
        },
    };
}

const ready = (page) =>
    page.waitForFunction(() => /** @type {any} */ (window).__app?.ready === true, null, {
        timeout: READY_TIMEOUT_MS,
        polling: 250,
    });

const app = (page, fn, arg) =>
    page.evaluate(
        ([src, a]) =>
            new Function('app', 'arg', `return (${src})(app, arg)`)(
                /** @type {any} */ (window).__app,
                a
            ),
        [fn.toString(), arg]
    );

const noBanner = (page) => page.evaluate(() => !document.getElementById('app-error-banner'));
const hasWasm = (page) => app(page, (a) => Boolean(a.isWasmAvailable?.()));

async function clean(c, label) {
    check(
        c.problems.length === 0,
        `${label}: no uncaught errors / unexpected console errors`,
        c.problems.slice(0, 3).join(' | ')
    );
    check(await noBanner(c.page), `${label}: no error banner`);
}

try {
    // ── storage ────────────────────────────────────────────────────────────
    {
        const c = await openCase('localStorage unavailable (blocked cookies / private mode)', {
            init: () => {
                const deny = () => {
                    throw new DOMException('The operation is insecure.', 'SecurityError');
                };
                Object.defineProperty(window, 'localStorage', { get: deny, configurable: true });
                Object.defineProperty(window, 'sessionStorage', { get: deny, configurable: true });
            },
        });
        check(true, 'reaches ready with every storage getter throwing');
        // Volume / mute write through localStorage; they must not throw.
        await c.page.evaluate(() => {
            const slider = /** @type {HTMLInputElement | null} */ (
                document.querySelector('input[type="range"]')
            );
            if (slider) {
                slider.value = '0.3';
                slider.dispatchEvent(new Event('input'));
            }
        });
        await clean(c, 'storage blocked');
        await c.close();
    }

    // ── audio ──────────────────────────────────────────────────────────────
    {
        const c = await openCase('AudioContext blocked / unconstructible', {
            init: () => {
                const boom = function () {
                    throw new Error('AudioContext is not allowed');
                };
                /** @type {any} */ (window).AudioContext = boom;
                /** @type {any} */ (window).webkitAudioContext = boom;
            },
        });
        await c.page.keyboard.press('Space'); // the gesture that normally unlocks audio
        await c.page.mouse.click(40, 40);
        await c.page.waitForTimeout(500);
        check(true, 'reaches ready and survives the unlock gesture without an AudioContext');
        await clean(c, 'audio blocked');
        await c.close();
    }
    {
        const c = await openCase('no AudioWorklet (old Safari / insecure context)', {
            init: () => {
                delete (/** @type {any} */ (window).AudioWorkletNode);
                if (window.AudioContext) {
                    Object.defineProperty(window.AudioContext.prototype, 'audioWorklet', {
                        get: () => undefined,
                        configurable: true,
                    });
                }
            },
        });
        await c.page.keyboard.press('Space');
        await c.page.waitForTimeout(1500);
        const audio = await app(c.page, (a) => a.audio?.getStats?.() ?? null);
        check(
            audio == null || audio.synth !== 'worklet',
            'synth falls back off the worklet path',
            JSON.stringify(audio?.synth)
        );
        await clean(c, 'no AudioWorklet');
        await c.close();
    }

    // ── URLs ───────────────────────────────────────────────────────────────
    {
        const query = `${BASE_QUERY}&seed=abc&v=99&dice=zzz:9,d6:-4,d20:999&ids=a,,-1,1e9&w=nothex&layout-seed=-1&density=huge&theme=nope&src=bogus&scene=nope&room=%00%00`;
        const c = await openCase('malformed share URL', { query });
        const scene = await app(c.page, (a) => a.sceneDocument?.id);
        check(scene === 'tavern', 'unknown ?scene= falls back to the tavern', String(scene));
        await clean(c, 'malformed share URL');
        await c.close();
    }
    {
        const c = await openCase('?room= with a dead signaling server', {
            query: `${BASE_QUERY}&room=ABCD&signal=http://127.0.0.1:9`,
        });
        check(true, 'reaches ready although the room cannot be reached');
        // The room stack is a lazy chunk plus a solver-id fetch: give it time on a slow runner.
        await c.page
            .waitForFunction(() => Boolean(/** @type {any} */ (window).__app.multiplayer), null, {
                timeout: 90000,
                polling: 250,
            })
            .catch(() => {});
        const mp = await app(c.page, (a) => Boolean(a.multiplayer));
        check(
            mp === true,
            'the room session exists and reports its failure through its own status, not a crash'
        );
        // A dead server is a handled condition: connection errors are reported by the panel, not as uncaught errors.
        check(
            c.problems.filter(
                (p) => !/ERR_CONNECTION|127\.0\.0\.1:9|Failed to fetch|NetworkError/i.test(p)
            ).length === 0,
            'no uncaught errors from the failed join',
            c.problems.join(' | ')
        );
        check(await noBanner(c.page), 'no error banner for a dead signaling server');
        await c.close();
    }

    // ── viewport / orientation ─────────────────────────────────────────────
    {
        const c = await openCase('window resize and device rotation');
        const sizeOk = () =>
            app(c.page, () => {
                const canvas = document.querySelector('#canvas-container canvas');
                const box = document.getElementById('canvas-container');
                return (
                    !!canvas &&
                    !!box &&
                    Math.abs(canvas.clientWidth - box.clientWidth) <= 1 &&
                    Math.abs(canvas.clientHeight - box.clientHeight) <= 1
                );
            });
        const aspect = () => app(c.page, (a) => a.camera.aspect);
        const a0 = await aspect();
        await c.page.setViewportSize({ width: 270, height: 360 }); // portrait
        await c.page.waitForTimeout(400);
        const a1 = await aspect();
        check(
            Math.abs(a1 - 270 / 360) < 0.02,
            'portrait: camera aspect follows the viewport',
            `${a0} -> ${a1}`
        );
        check(await sizeOk(), 'portrait: canvas fills its container');
        await c.page.setViewportSize({ width: 480, height: 200 }); // extreme landscape
        await c.page.waitForTimeout(400);
        check(await sizeOk(), 'extreme landscape: canvas fills its container');
        await c.page.setViewportSize({ width: 1, height: 1 }).catch(() => {});
        await c.page.setViewportSize(VIEWPORT);
        await c.page.waitForTimeout(400);
        check(await sizeOk(), 'a degenerate 1x1 viewport and back leaves a usable canvas');
        await clean(c, 'resize / rotation');
        await c.close();
    }

    // ── GPU ────────────────────────────────────────────────────────────────
    {
        const c = await openCase('WebGL context loss and restore');
        const before = await app(c.page, (a) => a.stats.frame);
        await app(c.page, (a) => {
            const gl = a.renderer.getContext();
            // A lost context returns null for getExtension: keep the handle for the restore.
            const ext = gl.getExtension('WEBGL_lose_context');
            /** @type {any} */ (window).__loseCtx = ext;
            ext.loseContext();
        });
        await c.page.waitForTimeout(1500);
        const lost = await app(c.page, (a) => ({
            lost: a.renderer.getContext().isContextLost?.() ?? null,
            frame: a.stats.frame,
        }));
        check(lost.lost === true, 'the context reports lost', JSON.stringify(lost));
        await c.page.evaluate(() => /** @type {any} */ (window).__loseCtx.restoreContext());
        await c.page
            .waitForFunction(
                (f) =>
                    /** @type {any} */ (window).__app.stats.frame > f + 2 &&
                    !(/** @type {any} */ (window).__app.renderer.getContext().isContextLost()),
                before,
                { timeout: 90000, polling: 250 }
            )
            .then(
                () => check(true, 'after restoreContext the loop draws again'),
                () => check(false, 'after restoreContext the loop draws again')
            );
        // The page must never be left silently black: either it recovered (above), or a banner says so.
        check(
            c.problems.filter((p) => p.startsWith('pageerror')).length === 0,
            'context loss raises no uncaught error',
            c.problems.join(' | ')
        );
        await c.close();
    }

    // ── rolls (need the dice) ──────────────────────────────────────────────
    {
        const c = await openCase('rolls: zero dice, max dice, R spam, hidden tab, resize mid-roll');
        const wasm = await hasWasm(c.page);
        const setCounts = (counts) =>
            c.page.evaluate((cs) => {
                for (const [t, n] of Object.entries(cs)) {
                    const input = /** @type {HTMLInputElement | null} */ (
                        document.getElementById(`dice-count-${t}`)
                    );
                    if (input) {
                        input.value = String(n);
                        input.dispatchEvent(new Event('change'));
                    }
                }
            }, counts);
        const ZERO = { d4: 0, d6: 0, d8: 0, d10: 0, d12: 0, d20: 0 };
        const MAX = { d4: 10, d6: 10, d8: 10, d10: 10, d12: 10, d20: 10 };

        // Zero dice: valid with or without physics; pressing R must not throw.
        await setCounts(ZERO);
        await c.page.keyboard.press('r');
        await c.page.waitForTimeout(800);
        check(true, '0 dice: R does nothing harmful');
        const state0 = await app(c.page, (a) => a.getRollState().phase);
        check(state0 !== 'rolling', '0 dice: the roll does not hang in "rolling"', state0);

        // Input clamping: the UI caps each type at 10 whatever is typed.
        await setCounts({ d6: 999 });
        const clamped = await c.page.evaluate(() =>
            Number(/** @type {HTMLInputElement} */ (document.getElementById('dice-count-d6')).value)
        );
        check(clamped <= 10, 'typing 999 d6 is clamped to the UI maximum', String(clamped));
        await setCounts(ZERO);

        if (!wasm) {
            if (REQUIRE_WASM)
                check(false, 'physics (WASM) is required for the roll cases (REQUIRE_WASM=1)');
            else
                for (const label of [
                    'max dice (60) settle',
                    'R spam settles to one consistent state',
                    'tab hidden/visible mid-roll',
                    'resize mid-roll',
                    'roll during CRIT_REPLAY',
                ])
                    skip(`${label} (no WASM in this build)`);
        } else {
            // Max dice: 60 dice settle without the timeout.
            await setCounts(MAX);
            await c.page.waitForFunction(
                () => {
                    let n = 0;
                    /** @type {any} */ (window).__app.scene.traverse((o) => {
                        if (o.userData?.isDie) n += 1;
                    });
                    return n === 60;
                },
                null,
                { timeout: 120000, polling: 250 }
            );
            const settledBefore = await app(c.page, (a) => a.getRollState().settledCount);
            await app(c.page, (a) => a.replayRoll(1234));
            // Resize + hidden tab while it is rolling.
            await c.page.setViewportSize({ width: 300, height: 400 });
            await c.page.evaluate(() => {
                Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
                document.dispatchEvent(new Event('visibilitychange'));
            });
            await c.page.waitForTimeout(1500);
            await c.page.evaluate(() => {
                Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
                document.dispatchEvent(new Event('visibilitychange'));
            });
            await c.page.waitForFunction(
                (n) => {
                    const s = /** @type {any} */ (window).__app.getRollState();
                    return s.settledCount > n && s.phase !== 'rolling';
                },
                settledBefore,
                { timeout: 240000, polling: 250 }
            );
            const maxState = await app(c.page, (a) => a.getRollState());
            check(
                maxState.phase === 'settled',
                '60 dice, hidden + resized mid-roll: the roll settles',
                `${maxState.phase} ${maxState.lastTimeoutReason ?? ''}`
            );

            // R spam: 25 presses must leave exactly one coherent roll state and end.
            await setCounts({ ...ZERO, d6: 4 });
            await c.page.waitForTimeout(500);
            const spamBefore = await app(c.page, (a) => a.getRollState().startedCount);
            for (let i = 0; i < 25; i++) await c.page.keyboard.press('r');
            await c.page.waitForFunction(
                () => {
                    const s = /** @type {any} */ (window).__app.getRollState();
                    return s.phase !== 'rolling' && s.phase !== 'idle';
                },
                null,
                { timeout: 240000, polling: 250 }
            );
            const spam = await app(c.page, (a) => a.getRollState());
            check(
                spam.startedCount >= spamBefore + 1,
                'R spam starts at least one roll',
                JSON.stringify(spam)
            );
            check(
                spam.settledCount <= spam.startedCount,
                'R spam never reports more settles than starts',
                JSON.stringify(spam)
            );
            skip('roll during CRIT_REPLAY (covered by test:roll-theatre; see docs/EDGE_CASES.md)');
        }
        await clean(c, 'rolls');
        await c.close();
    }

    // ── offline after first load ───────────────────────────────────────────
    {
        console.log('\n# offline after the first load');
        const ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'allow' });
        const page = await ctx.newPage();
        const problems = [];
        page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
        // No ?test-only host quirks: the real production page, service worker and all.
        await page.goto(url(`/?${BASE_QUERY}`), { waitUntil: 'load', timeout: 120000 });
        await ready(page);
        const sw = await page.evaluate(async () => {
            if (!('serviceWorker' in navigator)) return { supported: false };
            const reg = await Promise.race([
                navigator.serviceWorker.ready,
                new Promise((r) => setTimeout(() => r(null), 30000)),
            ]);
            return { supported: true, active: Boolean(reg && /** @type {any} */ (reg).active) };
        });
        if (!sw.supported || !sw.active) {
            check(false, 'a service worker is active after the first load', JSON.stringify(sw));
        } else {
            // Give the precache a moment to finish (install completes before `ready`, runtime caches fill as used).
            await page.waitForTimeout(3000);
            await ctx.setOffline(true);
            await page.reload({ waitUntil: 'load', timeout: 120000 });
            await ready(page);
            check(true, 'offline reload (service worker) reaches ready');
            const shown = await page.evaluate(() => ({
                canvas: Boolean(document.querySelector('#canvas-container canvas')),
                overlayGone: !document.getElementById('loading-overlay'),
                banner: Boolean(document.getElementById('app-error-banner')),
            }));
            check(
                shown.canvas && shown.overlayGone,
                'offline: the tavern draws',
                JSON.stringify(shown)
            );
            check(!shown.banner, 'offline: no error banner');
            await ctx.setOffline(false);
        }
        check(
            problems.length === 0,
            'offline: no uncaught errors',
            problems.slice(0, 3).join(' | ')
        );
        await ctx.close();
    }
} catch (error) {
    console.log(`FAIL: edge-case run aborted: ${error.stack || error.message}`);
    failed += 1;
}

await browser.close();
console.log(
    `\nedge cases: ${failed === 0 ? 'all asserted cases passed' : `${failed} check(s) failed`}${skipped ? `, ${skipped} skipped (no WASM)` : ''}`
);
process.exit(failed === 0 ? 0 : 1);
