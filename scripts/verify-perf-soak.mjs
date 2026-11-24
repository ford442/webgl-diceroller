#!/usr/bin/env node
/**
 * Performance soak (#383): N rolls of a 20-die set against a production build,
 * recording frame time, JS heap, renderer.info and audio voices, and failing on
 * monotonic growth.
 *
 *   npm run build && npm run preview          # (full build: dice need WASM)
 *   npm run verify:perf-soak                  # starts its own `vite preview`
 *   npm run verify:perf-soak -- --url https://test.1ink.us/dice-roller/ --rolls 200
 *
 * Options (flag, or env in capitals):
 *   --url <base>          SOAK_URL / DICE_BASE_URL  Test a deployed build instead of a local preview.
 *   --rolls <n>           SOAK_ROLLS (200)          Rolls in the measured phase.
 *   --warmup <n>          SOAK_WARMUP (5)           Rolls before the first sample (shaders, pools).
 *   --sample-every <n>    SOAK_SAMPLE_EVERY (20)    Roll interval between resource samples.
 *   --churn-every <n>     SOAK_CHURN_EVERY (10)     Swap between two 20-die sets every n rolls
 *                                                   (exercises updateDiceSet teardown); 0 = off.
 *   --viewport WxH        SOAK_VIEWPORT (1280x720)
 *   --query <qs>          SOAK_QUERY ("webgl&no-post&test")  Page flags; add "&debug-perf" for the HUD.
 *   --heap-tolerance-mb   SOAK_HEAP_MB (15)         Allowed post-GC heap growth.
 *   --max-p95-ratio       SOAK_P95_RATIO (1.35)     Allowed last/first window p95 frame-time ratio.
 *   --target-p95-ms       SOAK_TARGET_P95_MS        Optional absolute p95 target for this device class.
 *   --out <dir>           SOAK_OUT (soak/)          Where report.json is written.
 *   --report-only         SOAK_REPORT_ONLY=1        Record, never fail on the growth/degradation checks.
 *   --allow-no-wasm       Run (and pass) without physics: only a harness check, rolls are skipped.
 *
 * Exit: 0 pass; 1 growth / degradation / roll timeouts; 2 cannot soak (no WASM, no ready).
 *
 * What counts as "growth" is stated in scripts/lib/soakAnalysis.mjs (median of
 * the first quarter of samples vs the last, plus an upward least-squares trend)
 * and the tolerances below: geometries / textures / programs / scene objects /
 * dice meshes must not move at all; JS heap may grow by --heap-tolerance-mb.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startPreview } from '../tests/helpers/server.js';
import { detectDegradation, detectGrowth, summarizeFrames } from './lib/soakAnalysis.mjs';

function arg(name, envName, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i !== -1 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
    return process.env[envName] ?? fallback;
}
const flag = (name, envName) => process.argv.includes(`--${name}`) || process.env[envName] === '1';

const ROLLS = Number(arg('rolls', 'SOAK_ROLLS', 200));
const WARMUP = Number(arg('warmup', 'SOAK_WARMUP', 5));
const SAMPLE_EVERY = Number(arg('sample-every', 'SOAK_SAMPLE_EVERY', 20));
const CHURN_EVERY = Number(arg('churn-every', 'SOAK_CHURN_EVERY', 10));
const [VW, VH] = String(arg('viewport', 'SOAK_VIEWPORT', '1280x720'))
    .split('x')
    .map(Number);
const QUERY = String(arg('query', 'SOAK_QUERY', 'webgl&no-post&test'));
const HEAP_MB = Number(arg('heap-tolerance-mb', 'SOAK_HEAP_MB', 15));
const P95_RATIO = Number(arg('max-p95-ratio', 'SOAK_P95_RATIO', 1.35));
const TARGET_P95 = arg('target-p95-ms', 'SOAK_TARGET_P95_MS', null);
const OUT_DIR = path.resolve(String(arg('out', 'SOAK_OUT', 'soak')));
const REPORT_ONLY = flag('report-only', 'SOAK_REPORT_ONLY');
const ALLOW_NO_WASM = flag('allow-no-wasm', 'SOAK_ALLOW_NO_WASM');
const ROLL_TIMEOUT_MS = Number(arg('roll-timeout-ms', 'SOAK_ROLL_TIMEOUT_MS', 120000));
const READY_TIMEOUT_MS = Number(arg('ready-timeout-ms', 'SOAK_READY_TIMEOUT_MS', 300000));

/** Two different 20-die sets, so a swap really rebuilds meshes (10 per type is the UI max). */
const SET_A = { d4: 3, d6: 4, d8: 3, d10: 3, d12: 3, d20: 4 };
const SET_B = { d4: 4, d6: 3, d8: 4, d10: 3, d12: 3, d20: 3 };
const total = (set) => Object.values(set).reduce((a, b) => a + b, 0);
if (total(SET_A) !== 20 || total(SET_B) !== 20) throw new Error('soak dice sets must total 20');

const CHROMIUM_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    // Exact heap numbers and a real gc() between samples: otherwise the heap is a sawtooth.
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
];

const failures = [];
const fail = (msg) => {
    failures.push(msg);
    console.log(`FAIL: ${msg}`);
};
const note = (msg) => console.log(msg);
const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');

async function main() {
    let server = null;
    let base = arg('url', 'SOAK_URL', process.env.DICE_BASE_URL || '');
    if (!base) {
        server = await startPreview();
        base = server.base;
    }
    base = base.replace(/\/?$/, '/');
    const pageUrl = `${base}?${QUERY.replace(/^\?/, '')}`;

    const browser = await chromium.launch({
        headless: true,
        args: CHROMIUM_ARGS,
        executablePath: process.env.PW_CHROMIUM_PATH,
    });
    const page = await browser.newPage({ viewport: { width: VW, height: VH } });
    const consoleErrors = [];
    page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    const http404 = [];
    page.on('response', (r) => {
        if (r.status() >= 400) http404.push(`${r.status()} ${r.url()}`);
    });

    // Frame-interval sampler, independent of the app: what the compositor actually presented.
    await page.addInitScript(() => {
        const s = { buf: new Float32Array(1 << 18), n: 0, last: 0, on: false };
        /** @type {any} */ (window).__soakFrames = s;
        const tick = (t) => {
            if (s.on && s.last && s.n < s.buf.length) s.buf[s.n++] = t - s.last;
            s.last = t;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });

    const report = {
        url: pageUrl,
        startedAt: new Date().toISOString(),
        config: {
            ROLLS,
            WARMUP,
            SAMPLE_EVERY,
            CHURN_EVERY,
            viewport: [VW, VH],
            QUERY,
            HEAP_MB,
            P95_RATIO,
        },
    };

    try {
        const t0 = Date.now();
        await page.goto(pageUrl, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(() => /** @type {any} */ (window).__app?.ready === true, null, {
            timeout: READY_TIMEOUT_MS,
            polling: 250,
        });
        const readyWallMs = Date.now() - t0;

        const env = await page.evaluate(() => {
            const app = /** @type {any} */ (window).__app;
            const trace = app.bootTrace?.();
            return {
                userAgent: navigator.userAgent,
                crossOriginIsolated: window.crossOriginIsolated,
                hardwareConcurrency: navigator.hardwareConcurrency,
                deviceMemory: /** @type {any} */ (navigator).deviceMemory ?? null,
                devicePixelRatio: window.devicePixelRatio,
                rendererType: app.rendererType,
                qualityProfile: app.qualityProfile,
                wasm: Boolean(app.isWasmAvailable?.()),
                build: app.buildInfo ?? null,
                heapApi: typeof (/** @type {any} */ (performance).memory) === 'object',
                gc: typeof (/** @type {any} */ (window).gc) === 'function',
                bootTrace: trace
                    ? {
                          ready: trace.ready ?? null,
                          firstFrame: trace.firstFrame ?? null,
                          tiers: trace.tiers,
                          longTasks: trace.longTasks,
                      }
                    : null,
            };
        });
        report.env = env;
        report.boot = { readyWallMs };
        note(`ready after ${readyWallMs} ms (${env.rendererType}, profile ${env.qualityProfile})`);

        if (!env.wasm) {
            if (ALLOW_NO_WASM) {
                note('no WASM physics: harness check only, no rolls.');
                report.skipped = 'no-wasm';
                await finish(report, browser, server);
                return;
            }
            fail(
                'physics (WASM) is not available: the soak needs real dice (npm run build, not build:js:allow-missing-wasm)'
            );
            report.cannotRun = true;
            await finish(report, browser, server, 2);
            return;
        }

        const setDice = (set) =>
            page.evaluate((counts) => {
                for (const [type, n] of Object.entries(counts)) {
                    const input = /** @type {HTMLInputElement | null} */ (
                        document.getElementById(`dice-count-${type}`)
                    );
                    if (!input) throw new Error(`no dice-count-${type} input`);
                    input.value = String(n);
                    input.dispatchEvent(new Event('change'));
                }
            }, set);

        // A real gesture unlocks the AudioContext, so voices are part of what is measured.
        await page.keyboard.press('Space');
        await setDice(SET_A);
        // The engine registers the dice a beat after the inputs change.
        await page.waitForFunction(
            (n) => {
                let dice = 0;
                /** @type {any} */ (window).__app.scene.traverse((o) => {
                    if (o.userData?.isDie) dice += 1;
                });
                return dice === n;
            },
            total(SET_A),
            { timeout: 60000, polling: 200 }
        );

        // Idle fps before any roll.
        await page.evaluate(() => {
            const s = /** @type {any} */ (window).__soakFrames;
            s.n = 0;
            s.on = true;
        });
        await page.waitForTimeout(5000);
        const idle = await page.evaluate(() => {
            const s = /** @type {any} */ (window).__soakFrames;
            s.on = false;
            return Array.from(s.buf.slice(0, s.n));
        });
        report.idle = summarizeFrames(idle);
        note(
            `idle: ${fmt(report.idle.fps)} fps (p50 ${fmt(report.idle.p50)} ms, p95 ${fmt(report.idle.p95)} ms)`
        );

        const sample = () =>
            page.evaluate(async () => {
                const w = /** @type {any} */ (window);
                const app = w.__app;
                // Two GCs and a beat: finalisers and the second pass of a generational collector.
                w.gc?.();
                await new Promise((r) => setTimeout(r, 120));
                w.gc?.();
                await new Promise((r) => setTimeout(r, 120));
                const info = app.renderer?.info;
                let objects = 0;
                app.scene.traverse(() => {
                    objects += 1;
                });
                let dieMeshes = 0;
                app.scene.traverse((o) => {
                    if (o.userData?.isDie) dieMeshes += 1;
                });
                const audio = app.audio?.getStats?.() ?? null;
                return {
                    heapUsed: /** @type {any} */ (performance).memory?.usedJSHeapSize ?? null,
                    geometries: info?.memory?.geometries ?? null,
                    textures: info?.memory?.textures ?? null,
                    programs: Array.isArray(info?.programs) ? info.programs.length : null,
                    sceneObjects: objects,
                    dieMeshes,
                    audioActiveVoices: audio?.activeVoices ?? null,
                    audioEngine: audio?.engine ?? null,
                    audioPlayed: audio?.played ?? null,
                    audioSynth: audio?.synth ?? null,
                    errors: app.errors?.total?.() ?? 0,
                };
            });

        const rollOnce = async (i) => {
            const seed = (0x9e3779b1 * (i + 1)) >>> 0;
            await page.evaluate(() => {
                const s = /** @type {any} */ (window).__soakFrames;
                s.n = 0;
                s.on = true;
            });
            const before = await page.evaluate(
                () => /** @type {any} */ (window).__app.getRollState().settledCount
            );
            await page.evaluate((sd) => /** @type {any} */ (window).__app.replayRoll(sd), seed);
            await page.waitForFunction(
                (n) => {
                    const s = /** @type {any} */ (window).__app.getRollState();
                    return s.settledCount > n && s.phase !== 'rolling';
                },
                before,
                { timeout: ROLL_TIMEOUT_MS, polling: 100 }
            );
            const state = await page.evaluate(() =>
                /** @type {any} */ (window).__app.getRollState()
            );
            const frames = await page.evaluate(() => {
                const s = /** @type {any} */ (window).__soakFrames;
                s.on = false;
                return Array.from(s.buf.slice(0, s.n), (v) => Math.round(v * 10) / 10);
            });
            return { timedOut: state.phase === 'timedOut', frames };
        };

        for (let i = 0; i < WARMUP; i++) await rollOnce(-1 - i);
        report.start = await sample();
        note(`start: ${JSON.stringify(report.start)}`);

        const samples = [];
        const rollFrames = [];
        let timeouts = 0;
        const t1 = Date.now();
        for (let i = 0; i < ROLLS; i++) {
            if (CHURN_EVERY > 0 && i > 0 && i % CHURN_EVERY === 0) {
                await setDice(Math.floor(i / CHURN_EVERY) % 2 === 0 ? SET_A : SET_B);
            }
            const r = await rollOnce(i);
            rollFrames.push(r.frames);
            if (r.timedOut) timeouts += 1;
            // Sample when the set is A, so every sample sees the same dice.
            if (i % SAMPLE_EVERY === SAMPLE_EVERY - 1) {
                const onA = !(CHURN_EVERY > 0 && Math.floor(i / CHURN_EVERY) % 2 === 1);
                if (onA) {
                    samples.push({ roll: i + 1, ...(await sample()) });
                } else {
                    await setDice(SET_A);
                    await rollOnce(-100 - i); // one settle on the sampled set
                    samples.push({ roll: i + 1, ...(await sample()) });
                }
                if ((i + 1) % (SAMPLE_EVERY * 2) === 0)
                    note(`  ${i + 1}/${ROLLS} rolls, ${((Date.now() - t1) / 1000).toFixed(0)} s`);
            }
        }
        await page.waitForTimeout(2500); // let the audio tail drain
        report.end = await sample();
        report.samples = samples;
        report.rolls = { measured: ROLLS, timeouts, wallMs: Date.now() - t1 };

        // ---- frame time ------------------------------------------------------
        const all = rollFrames.flat();
        const window20 = Math.max(1, Math.min(20, Math.floor(ROLLS / 4)));
        const firstWindow = rollFrames.slice(0, window20).flat();
        const lastWindow = rollFrames.slice(-window20).flat();
        report.frameTime = {
            all: summarizeFrames(all),
            firstWindow: summarizeFrames(firstWindow),
            lastWindow: summarizeFrames(lastWindow),
        };
        const ft = report.frameTime.all;
        note(
            `frame time during rolls: p50 ${fmt(ft.p50)} ms  p95 ${fmt(ft.p95)} ms  p99 ${fmt(ft.p99)} ms  max ${fmt(ft.max)} ms  (${fmt(ft.fps)} fps median)`
        );

        const verdicts = {};
        verdicts.frameDegradation = detectDegradation(firstWindow, lastWindow, {
            maxRatio: P95_RATIO,
        });
        if (!verdicts.frameDegradation.ok)
            fail(`frame time degraded: ${verdicts.frameDegradation.reason}`);
        else note(`ok: frame time stable (${verdicts.frameDegradation.reason})`);
        if (TARGET_P95 != null && ft.p95 > Number(TARGET_P95)) {
            fail(
                `p95 frame time ${fmt(ft.p95)} ms exceeds the ${TARGET_P95} ms target for this device`
            );
        }

        // ---- resource growth -------------------------------------------------
        const series = (key) => samples.map((s) => s[key]);
        const checks = [
            ['heapUsed', HEAP_MB * 1024 * 1024],
            ['geometries', 0],
            ['textures', 0],
            ['programs', 0],
            ['sceneObjects', 0],
            ['dieMeshes', 0],
        ];
        for (const [key, tolerance] of checks) {
            const values = series(key);
            if (values.every((v) => v == null)) {
                note(`skip: ${key} is not reported by this build/renderer`);
                continue;
            }
            const verdict = detectGrowth(values, { tolerance });
            verdicts[key] = verdict;
            const scale = key === 'heapUsed' ? 1 / (1024 * 1024) : 1;
            const unit = key === 'heapUsed' ? ' MB' : '';
            if (verdict.skipped) note(`skip: ${key}: ${verdict.reason}`);
            else if (!verdict.ok)
                fail(
                    `${key} grew: ${fmt(verdict.first * scale, 2)}${unit} -> ${fmt(verdict.last * scale, 2)}${unit} (${verdict.reason})`
                );
            else
                note(
                    `ok: ${key} ${fmt(verdict.first * scale, 2)}${unit} -> ${fmt(verdict.last * scale, 2)}${unit}`
                );
        }

        // Audio: voices must come back down once the table is quiet, and never exceed the cap.
        const endVoices = report.end.audioActiveVoices;
        const maxVoices = report.end.audioEngine?.maxVoices ?? null;
        if (endVoices != null && endVoices > 4)
            fail(`audio voices still active after the table settled: ${endVoices}`);
        else if (endVoices != null)
            note(`ok: audio voices at rest ${endVoices} (start ${report.start.audioActiveVoices})`);
        if (
            report.end.audioEngine?.peakActive != null &&
            maxVoices != null &&
            report.end.audioEngine.peakActive > maxVoices
        ) {
            fail(
                `audio peakActive ${report.end.audioEngine.peakActive} exceeded maxVoices ${maxVoices}`
            );
        }

        if (timeouts > 0) fail(`${timeouts} of ${ROLLS} rolls hit the settle timeout`);
        if (report.end.errors > report.start.errors) {
            fail(
                `${report.end.errors - report.start.errors} new error(s) recorded by the error boundary during the soak`
            );
        }
        const unexpected = consoleErrors.filter((e) => !/Failed to load resource/.test(e));
        if (unexpected.length)
            fail(`console errors during the soak: ${unexpected.slice(0, 3).join(' | ')}`);

        report.verdicts = verdicts;
        report.http404 = http404;
    } catch (error) {
        fail(`soak aborted: ${error.message}`);
        report.aborted = error.message;
    }
    await finish(report, browser, server);
}

async function finish(report, browser, server, forceCode) {
    report.finishedAt = new Date().toISOString();
    report.failures = failures;
    report.passed = failures.length === 0;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, 'report.json');
    fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    note(`\nreport: ${file}`);
    await browser.close().catch(() => {});
    await server?.close();
    if (forceCode != null) process.exit(forceCode);
    if (failures.length && !REPORT_ONLY) {
        console.log(`\nsoak FAILED (${failures.length} check(s))`);
        process.exit(1);
    }
    console.log(failures.length ? '\nsoak: failures ignored (--report-only)' : '\nsoak passed');
    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    process.exit(2);
});
